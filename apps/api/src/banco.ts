// The standalone, customer-facing "Banco del Futuro" portal: a single site with
// several products (account, mortgage, credit, travel, loan). Each product card
// starts its BPM flow via the public /apply endpoints and renders the flow's
// forms dynamically from their schema, so no form is hard-coded here.
// Self-contained (inline CSS/JS); the page JS avoids ${}/backticks so it can live
// inside this template literal.

export function bancoPage(): string {
  return PAGE;
}

const PAGE = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Banco del Futuro</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,100..900&display=swap" rel="stylesheet" />
<style>
  :root{
    --brand:#0b3d91; --brand-2:#1e63d0; --accent:#00c2a8; --ink:#0f1b2d; --muted:#5b6b82;
    --line:#e6ebf3; --bg:#f5f8fd; --ok:#16a34a; --bad:#dc2626; --warn:#d97706;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:Inter,system-ui,sans-serif;font-optical-sizing:auto;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
  a{color:inherit}
  .top{background:linear-gradient(120deg,var(--brand),var(--brand-2));color:#fff}
  .top-inner{max-width:1080px;margin:0 auto;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
  .logo{display:flex;align-items:center;gap:12px;font-weight:800;font-size:18px;letter-spacing:.2px;cursor:pointer}
  .logo .mark{width:34px;height:34px;border-radius:10px;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center;font-size:18px}
  .top nav{display:flex;gap:22px;font-size:14px;opacity:.9}
  .hero{background:linear-gradient(120deg,var(--brand),var(--brand-2));color:#fff;padding:44px 24px 90px}
  .hero-inner{max-width:1080px;margin:0 auto}
  .hero h1{font-size:34px;margin:0 0 10px;letter-spacing:-.02em;font-weight:800}
  .hero p{margin:0;font-size:17px;opacity:.92;max-width:600px}
  .hero .pills{margin-top:18px;display:flex;gap:10px;flex-wrap:wrap}
  .pill{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:6px 12px;font-size:13px}
  .products{max-width:1080px;margin:-60px auto 40px;padding:0 20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
  .prod{background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:0 20px 50px -28px rgba(11,61,145,.35);padding:20px;cursor:pointer;transition:transform .15s,box-shadow .15s}
  .prod:hover{transform:translateY(-3px);box-shadow:0 26px 56px -26px rgba(11,61,145,.45)}
  .prod .ic{width:46px;height:46px;border-radius:12px;background:#eef4ff;display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:12px}
  .prod h3{margin:0 0 4px;font-size:17px}
  .prod p{margin:0;color:var(--muted);font-size:13.5px}
  .prod .go{margin-top:14px;color:var(--brand-2);font-weight:700;font-size:14px}
  .wrap{max-width:640px;margin:-64px auto 40px;padding:0 20px}
  .back{display:inline-flex;align-items:center;gap:6px;color:#fff;opacity:.9;font-size:14px;cursor:pointer;margin-bottom:14px}
  .card{background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 20px 50px -20px rgba(11,61,145,.35);padding:26px}
  h2{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}
  .sub{color:var(--muted);font-size:14px;margin:0 0 20px}
  label{display:block;font-size:13px;font-weight:600;color:#33445c;margin:14px 0 6px}
  input,select{width:100%;border:1px solid #cdd7e6;border-radius:11px;padding:12px 13px;font-size:15px;font-family:inherit;color:var(--ink);background:#fff;transition:border-color .15s,box-shadow .15s}
  input:focus,select:focus{outline:none;border-color:var(--brand-2);box-shadow:0 0 0 4px rgba(30,99,208,.15)}
  .btn{width:100%;margin-top:22px;background:linear-gradient(120deg,var(--brand),var(--brand-2));color:#fff;border:0;border-radius:12px;padding:14px 16px;font-size:16px;font-weight:700;cursor:pointer;transition:filter .15s,transform .08s}
  .btn:hover{filter:brightness(1.06)} .btn:active{transform:translateY(1px)} .btn:disabled{opacity:.6;cursor:not-allowed}
  .btn.ghost{background:#fff;color:var(--brand);border:1.5px solid #cdd7e6}
  .btn.ghost:hover{background:#f5f8fd;filter:none}
  .secure{margin-top:14px;text-align:center;color:var(--muted);font-size:12px}
  .center{text-align:center;padding:14px 0}
  .spinner{width:46px;height:46px;border:4px solid #e6ebf3;border-top-color:var(--brand-2);border-radius:50%;animation:spin 1s linear infinite;margin:8px auto 16px}
  @keyframes spin{to{transform:rotate(360deg)}}
  .badge{display:inline-flex;align-items:center;gap:8px;padding:7px 14px;border-radius:999px;font-weight:700;font-size:14px}
  .badge.ok{background:#e7f7ee;color:var(--ok)} .badge.rev{background:#fff4e5;color:var(--warn)} .badge.bad{background:#fdeaea;color:var(--bad)}
  .offer{margin:18px 0;border:1px solid var(--line);border-radius:14px;overflow:hidden}
  .offer .grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line)}
  .offer .grid div{background:#fff;padding:14px 16px}
  .offer .grid .k{font-size:12px;color:var(--muted)} .offer .grid .v{font-size:17px;font-weight:700;margin-top:2px}
  .ai{background:#f2f7ff;border:1px solid #dbe7fb;border-radius:12px;padding:13px 14px;font-size:13.5px;color:#274060;margin-top:14px}
  .ai b{color:var(--brand)}
  .check{display:flex;gap:10px;align-items:flex-start;font-size:14px;margin-top:14px}
  .check input{width:18px;height:18px;margin-top:2px}
  .ro{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);font-size:14px}
  .ro .k{color:var(--muted)} .ro .v{font-weight:700}
  .foot{max-width:1080px;margin:0 auto;padding:24px;color:#8a99ad;font-size:12px;text-align:center}
  .err{background:#fdeaea;color:#991b1b;border:1px solid #f6caca;border-radius:10px;padding:10px 12px;font-size:13px;margin-top:12px}
</style>
</head>
<body>
  <header class="top"><div class="top-inner">
    <div class="logo" id="home"><span class="mark">✦</span> Banco del Futuro</div>
    <nav><span>Cuentas</span><span>Tarjetas</span><span>Préstamos</span><span>Ayuda</span></nav>
  </div></header>
  <div id="app"></div>
  <footer class="foot">Banco del Futuro · Demo · Powered by Neuratek Cassiopeia</footer>

<script>
(function(){
  var PRODUCTS=[
    {key:"cuenta",token:"banco-cuenta",title:"Apertura de cuenta",tagline:"Abrí tu cuenta 100% online, con verificación por IA.",icon:"🏦"},
    {key:"prestamo",token:"banco-del-futuro-loan",title:"Préstamo personal",tagline:"Pre-aprobado con IA en minutos. Sin filas.",icon:"💵"},
    {key:"credito",token:"banco-credito",title:"Crédito personal",tagline:"Scoring instantáneo con inteligencia artificial.",icon:"💳"},
    {key:"hipoteca",token:"banco-hipoteca",title:"Hipoteca",tagline:"Simulá y solicitá tu hipoteca en un paso.",icon:"🏠"},
    {key:"viaje",token:"banco-viaje",title:"Aviso de viaje",tagline:"Usá tu tarjeta en el exterior sin sorpresas.",icon:"✈️"}
  ];
  var app=document.getElementById("app");
  var state={prod:null,appId:null,poll:null};
  var money=function(n){ if(n==null||isNaN(n))return "—"; return new Intl.NumberFormat("es",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(n); };
  function esc(x){return String(x==null?"":x).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}
  document.getElementById("home").addEventListener("click",screenHome);

  // ---- landing ----
  function screenHome(){
    if(state.poll){clearInterval(state.poll);state.poll=null;}
    state.prod=null;state.appId=null;
    var cards="";
    for(var i=0;i<PRODUCTS.length;i++){var p=PRODUCTS[i];
      cards+='<div class="prod" data-k="'+p.key+'"><div class="ic">'+p.icon+'</div><h3>'+esc(p.title)+'</h3><p>'+esc(p.tagline)+'</p><div class="go">Empezar →</div></div>';}
    app.innerHTML=
      '<section class="hero"><div class="hero-inner"><h1>Tu banco, 100% digital.</h1>'+
      '<p>Elegí un producto y resolvelo en minutos. Nuestros agentes de IA analizan tu caso al instante; un humano solo interviene cuando hace falta.</p>'+
      '<div class="pills"><span class="pill">🔒 Conexión segura</span><span class="pill">⚡ Respuesta inmediata</span><span class="pill">🤖 Decisiones con IA</span></div></div></section>'+
      '<div class="products">'+cards+'</div>';
    var els=app.querySelectorAll(".prod");
    for(var j=0;j<els.length;j++){ els[j].addEventListener("click",function(){ openProduct(this.getAttribute("data-k")); }); }
  }

  function shell(inner){
    app.innerHTML='<section class="hero" style="padding-bottom:90px"><div class="hero-inner"><div class="back" id="bk">← Volver a productos</div>'+
      '<h1 style="font-size:26px">'+esc(state.prod.title)+'</h1></div></section>'+
      '<main class="wrap"><div class="card" id="card">'+inner+'</div>'+
      '<div class="secure">🔒 Tus datos viajan cifrados. Banco del Futuro no comparte tu información.</div></main>';
    document.getElementById("bk").addEventListener("click",screenHome);
  }
  function setCard(html){ var c=document.getElementById("card"); if(c)c.innerHTML=html; }

  function openProduct(key){
    for(var i=0;i<PRODUCTS.length;i++) if(PRODUCTS[i].key===key) state.prod=PRODUCTS[i];
    state.appId=null;
    shell('<div class="center"><div class="spinner"></div></div>');
    fetch("/apply/"+state.prod.token+"/intake").then(function(r){return r.json();}).then(function(res){
      if(res.ok===false||!res.form)throw new Error(res.error||"Producto no disponible");
      setCard(formHtml(res.form,{},"Completá tus datos","Empezar →"));
      wireForm(res.form,function(data){ start(data); });
    }).catch(function(e){ setCard(errHtml(e.message)); });
  }

  // ---- generic schema-driven form renderer ----
  function fieldHtml(f,summary){
    var v=summary&&(summary[f.expr]!=null?summary[f.expr]:summary[f.bind]);
    if(f.kind==="computed"){ return '<div class="ro"><span class="k">'+esc(f.label)+'</span><span class="v">'+esc(fmt(f,v))+'</span></div>'; }
    if(f.kind==="checkbox"){ return '<label class="check"><input type="checkbox" name="'+f.bind+'"'+(f.required?" data-req=1":"")+' /> '+esc(f.label)+'</label>'; }
    var lab='<label>'+esc(f.label)+(f.required?' *':'')+'</label>';
    if(f.kind==="select"){ var o="";for(var i=0;i<(f.options||[]).length;i++){o+='<option value="'+esc(f.options[i].value)+'">'+esc(f.options[i].label)+'</option>';} return lab+'<select name="'+f.bind+'"'+(f.required?" required":"")+'>'+o+'</select>'; }
    var type=f.kind==="number"?"number":f.kind==="email"?"email":f.kind==="date"?"date":"text";
    var attr=(f.required?" required":"")+(f.min!=null?' min="'+f.min+'"':"")+(f.max!=null?' max="'+f.max+'"':"")+(f.pattern?' pattern="'+esc(f.pattern)+'"':"")+(f.defaultValue!=null?' value="'+esc(f.defaultValue)+'"':"");
    return lab+'<input name="'+f.bind+'" type="'+type+'"'+attr+' />';
  }
  function fmt(f,v){ if(v==null||v==="")return "—"; if(/payment|amount|income|value/i.test(f.expr||f.bind||""))return money(v); return String(v); }
  function formHtml(form,summary,heading,btn){
    var fields=form.fields||[], body="";
    for(var i=0;i<fields.length;i++) body+=fieldHtml(fields[i],summary);
    return '<h2>'+esc(heading||form.title)+'</h2><p class="sub">'+esc(state.prod.tagline)+'</p><form id="f">'+body+'<button class="btn" type="submit">'+esc(btn||"Continuar →")+'</button><div id="ferr"></div></form>';
  }
  function wireForm(form,onData){
    var el=document.getElementById("f"); if(!el)return;
    el.addEventListener("submit",function(e){
      e.preventDefault();
      var data={},fields=form.fields||[];
      for(var i=0;i<fields.length;i++){ var f=fields[i]; if(f.kind==="computed")continue;
        var node=el.elements[f.bind]; if(!node)continue;
        if(f.kind==="checkbox"){ if(node.getAttribute&&node.getAttribute("data-req")&&!node.checked){ ferr("Tenés que aceptar para continuar."); return; } data[f.bind]=!!node.checked; }
        else { var val=node.value; if(f.kind==="number") val=val===""?null:Number(val); data[f.bind]=val; }
      }
      onData(data);
    });
  }
  function ferr(m){ var e=document.getElementById("ferr"); if(e)e.innerHTML='<div class="err">'+esc(m)+'</div>'; }

  // ---- flow driving ----
  function start(data){
    screenAnalyzing();
    fetch("/apply/"+state.prod.token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)})
      .then(function(r){return r.json();}).then(function(res){ if(res.ok===false)throw new Error(res.error||"Error"); state.appId=res.appId; route(res); })
      .catch(function(e){ setCard(errHtml(e.message)); });
  }
  function step(data){
    setCard('<div class="center"><div class="spinner"></div><h2>Procesando…</h2></div>');
    fetch("/apply/"+state.prod.token+"/"+state.appId+"/step",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)})
      .then(function(r){return r.json();}).then(function(res){ if(res.ok===false)throw new Error(res.error||"Error"); route(res); })
      .catch(function(e){ setCard(errHtml(e.message)); });
  }
  function screenAnalyzing(){ setCard('<div class="center"><div class="spinner"></div><h2>Analizando tu solicitud…</h2><p class="sub">Nuestro agente de IA está evaluando tu caso.</p></div>'); }

  function route(res){
    if(res.stage==="form"){ screenStep(res); }
    else if(res.stage==="review"){ screenReview(res); }
    else if(res.stage==="processing"){ setTimeout(function(){ poll(); },1500); }
    else if(res.stage==="done"){ screenDone(res); }
    else { setCard(errHtml(res.message||"No pudimos procesar tu solicitud.")); }
  }
  function poll(){ fetch("/apply/"+state.prod.token+"/"+state.appId).then(function(r){return r.json();}).then(route).catch(function(){ setTimeout(poll,2000); }); }

  function aiNote(s){ return s&&s.reasoning ? '<div class="ai">🤖 <b>Análisis del agente (IA):</b> '+esc(s.reasoning)+(s.creditScore!=null?' · Score: <b>'+esc(s.creditScore)+'</b>':'')+'</div>' : ''; }

  function screenStep(res){
    var form=res.form,s=res.summary||{};
    setCard('<span class="badge ok">✓ Análisis listo</span><div style="height:12px"></div>'+aiNote(s)+formHtml(form,s,form.title,"Confirmar →"));
    wireForm(form,function(data){ step(data); });
  }
  function screenReview(res){
    setCard('<div class="center"><div class="spinner"></div><span class="badge rev">⏳ En revisión</span><h2 style="margin-top:14px">Un especialista está revisando tu caso</h2><p class="sub">Tu solicitud requiere una revisión adicional. Te mostramos el resultado apenas esté listo — no cierres esta página.</p></div>');
    if(!state.poll){ state.poll=setInterval(function(){ fetch("/apply/"+state.prod.token+"/"+state.appId).then(function(r){return r.json();}).then(function(res){ if(res.stage!=="review"){ clearInterval(state.poll); state.poll=null; route(res); } }).catch(function(){}); },3000); }
  }
  function screenDone(res){
    var s=res.summary||{}, ok=res.outcome!=="declined";
    var rows="";
    var add=function(k,v){ if(v!=null&&v!=="") rows+='<div class="ro"><span class="k">'+k+'</span><span class="v">'+v+'</span></div>'; };
    add("Titular",s.fullName?esc(s.fullName):null);
    add("Cuenta",s.accountId?esc(s.accountId):null);
    add("Monto",s.amount!=null?money(s.amount):null);
    add("Cuota mensual",s.monthlyPayment!=null?money(s.monthlyPayment):null);
    add("Score crediticio",s.creditScore!=null?esc(s.creditScore):null);
    add("Referencia",s.reference?esc(s.reference):null);
    add("Cobertura",s.coverage?esc(s.coverage):null);
    add("Nivel de riesgo",s.riskLevel?esc(s.riskLevel):null);
    var head = ok
      ? '<div style="font-size:52px">🎉</div><span class="badge ok">✓ '+esc(res.title||"Listo")+'</span><h2 style="margin-top:14px">¡Todo listo!</h2>'
      : '<span class="badge bad">'+esc(res.title||"No aprobado")+'</span><h2 style="margin-top:14px">No pudimos avanzar</h2>';
    var msg = ok ? '<p class="sub">Tu solicitud fue procesada con éxito.</p>' : '<p class="sub">Según nuestra evaluación, en este momento no podemos avanzar. Podés intentarlo más adelante.</p>';
    setCard('<div class="center">'+head+msg+'</div>'+(rows?'<div class="offer" style="margin-top:6px"><div style="padding:6px 16px">'+rows+'</div></div>':'')+aiNote(s)+
      '<button class="btn ghost" id="again" style="max-width:280px;margin:18px auto 0">Volver a productos</button>');
    var b=document.getElementById("again"); if(b)b.addEventListener("click",screenHome);
  }
  function errHtml(msg){ return '<div class="center"><h2>Ups…</h2><p class="sub">'+esc(msg)+'</p><button class="btn ghost" onclick="location.reload()" style="max-width:260px;margin:0 auto">Reintentar</button></div>'; }

  screenHome();
})();
</script>
</body>
</html>`;
