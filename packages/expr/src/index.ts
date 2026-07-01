// A tiny, safe expression evaluator. NO eval / Function — hand-written
// recursive-descent parser. Shared by process gateways and (later) form
// conditional logic (visibleIf / validators).
//
// Supported grammar (lowest -> highest precedence):
//   or    := and ("||" and)*
//   and   := cmp ("&&" cmp)*
//   cmp   := add (("=="|"!="|"<"|"<="|">"|">=") add)*
//   add   := mul (("+"|"-") mul)*
//   mul   := unary (("*"|"/") unary)*
//   unary := ("!"|"-") unary | primary
//   primary := number | string | true | false | null | ident | "(" or ")"
//   ident := name ("." name)*   -> looked up in the context object

export type ExprValue = string | number | boolean | null;
export type ExprContext = Record<string, unknown>;

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ident"; v: string }
  | { t: "op"; v: string }
  | { t: "eof" };

const OPS = ["==", "!=", "<=", ">=", "&&", "||", "<", ">", "+", "-", "*", "/", "!", "(", ")"];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < src.length) {
          s += src[j + 1];
          j += 2;
        } else {
          s += src[j++];
        }
      }
      if (j >= src.length) throw new Error("Unterminated string literal");
      toks.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      toks.push({ t: "num", v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
      toks.push({ t: "ident", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS.includes(two)) {
      toks.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if (OPS.includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected character '${c}' at ${i}`);
  }
  toks.push({ t: "eof" });
  return toks;
}

const KEYWORDS: Record<string, ExprValue> = {
  true: true,
  false: false,
  null: null,
};

function lookup(ctx: ExprContext, path: string): ExprValue {
  let cur: unknown = ctx;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  if (cur === undefined) return null;
  if (typeof cur === "object") return null; // objects/arrays not comparable in MVP
  return cur as ExprValue;
}

class Parser {
  private pos = 0;
  constructor(private toks: Tok[], private ctx: ExprContext) {}

  private peek(): Tok {
    return this.toks[this.pos];
  }
  private next(): Tok {
    return this.toks[this.pos++];
  }
  private eatOp(v: string): boolean {
    const t = this.peek();
    if (t.t === "op" && t.v === v) {
      this.pos++;
      return true;
    }
    return false;
  }

  parse(): ExprValue {
    const v = this.or();
    if (this.peek().t !== "eof") throw new Error("Unexpected trailing tokens");
    return v;
  }

  private or(): ExprValue {
    let left = this.and();
    while (this.eatOp("||")) {
      const right = this.and();
      left = truthy(left) ? left : right;
    }
    return left;
  }
  private and(): ExprValue {
    let left = this.cmp();
    while (this.eatOp("&&")) {
      const right = this.cmp();
      left = truthy(left) ? right : left;
    }
    return left;
  }
  private cmp(): ExprValue {
    let left = this.add();
    for (;;) {
      const t = this.peek();
      if (t.t !== "op" || !["==", "!=", "<", "<=", ">", ">="].includes(t.v)) break;
      this.next();
      const right = this.add();
      left = compare(t.v, left, right);
    }
    return left;
  }
  private add(): ExprValue {
    let left = this.mul();
    for (;;) {
      const t = this.peek();
      if (t.t !== "op" || (t.v !== "+" && t.v !== "-")) break;
      this.next();
      const right = this.mul();
      if (t.v === "+") {
        if (typeof left === "string" || typeof right === "string") {
          left = String(left ?? "") + String(right ?? "");
        } else {
          left = num(left) + num(right);
        }
      } else {
        left = num(left) - num(right);
      }
    }
    return left;
  }
  private mul(): ExprValue {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.t !== "op" || (t.v !== "*" && t.v !== "/")) break;
      this.next();
      const right = this.unary();
      left = t.v === "*" ? num(left) * num(right) : num(left) / num(right);
    }
    return left;
  }
  private unary(): ExprValue {
    if (this.eatOp("!")) return !truthy(this.unary());
    if (this.eatOp("-")) return -num(this.unary());
    return this.primary();
  }
  private primary(): ExprValue {
    const t = this.next();
    if (t.t === "num") return t.v;
    if (t.t === "str") return t.v;
    if (t.t === "ident") {
      if (t.v in KEYWORDS) return KEYWORDS[t.v];
      return lookup(this.ctx, t.v);
    }
    if (t.t === "op" && t.v === "(") {
      const v = this.or();
      if (!this.eatOp(")")) throw new Error("Expected ')'");
      return v;
    }
    throw new Error(`Unexpected token ${JSON.stringify(t)}`);
  }
}

function num(v: ExprValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v == null) return NaN;
  const n = Number(v);
  return n;
}
function truthy(v: ExprValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  return v != null;
}
function compare(op: string, a: ExprValue, b: ExprValue): boolean {
  switch (op) {
    case "==":
      return a === b;
    case "!=":
      return a !== b;
    case "<":
      return num(a) < num(b);
    case "<=":
      return num(a) <= num(b);
    case ">":
      return num(a) > num(b);
    case ">=":
      return num(a) >= num(b);
  }
  throw new Error(`Unknown comparator ${op}`);
}

/** Evaluate an expression against a context, returning its raw value. */
export function evaluate(expr: string, ctx: ExprContext): ExprValue {
  return new Parser(tokenize(expr), ctx).parse();
}

/** Evaluate an expression and coerce the result to a boolean. */
export function evalBool(expr: string, ctx: ExprContext): boolean {
  return truthy(evaluate(expr, ctx));
}
