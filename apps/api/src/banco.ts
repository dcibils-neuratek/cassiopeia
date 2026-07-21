// A standalone, customer-facing loan-application page ("Banco del Futuro"),
// served by the API and driving the BPM flow through the public /apply endpoints.
// Self-contained (inline CSS/JS); the page JS avoids ${}/backticks so it can live
// inside this template literal. %TOKEN% is replaced at serve time.

export function bancoPage(token: string): string {
  return PAGE.replace(/%TOKEN%/g, token);
}

const PAGE = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Banco del Futuro — Solicitud de préstamo</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&display=swap" rel="stylesheet" />
<style>
  :root{
    --brand:#0b3d91; --brand-2:#1e63d0; --accent:#00c2a8; --ink:#0f1b2d; --muted:#5b6b82;
    --line:#e6ebf3; --bg:#f5f8fd; --ok:#16a34a; --bad:#dc2626; --warn:#d97706;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:Manrope,system-ui,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
  .top{background:linear-gradient(120deg,var(--brand),var(--brand-2));color:#fff}
  .top-inner{max-width:1080px;margin:0 auto;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
  .logo{display:flex;align-items:center;gap:12px;font-weight:800;font-size:18px;letter-spacing:.2px}
  .logo .mark{width:34px;height:34px;border-radius:10px;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center;font-size:18px}
  .top nav{display:flex;gap:22px;font-size:14px;opacity:.9}
  .top nav span{cursor:default}
  .hero{background:linear-gradient(120deg,var(--brand),var(--brand-2));color:#fff;padding:44px 24px 90px}
  .hero-inner{max-width:1080px;margin:0 auto}
  .hero h1{font-size:34px;margin:0 0 10px;letter-spacing:-.02em;font-weight:800}
  .hero p{margin:0;font-size:17px;opacity:.92;max-width:560px}
  .hero .pills{margin-top:18px;display:flex;gap:10px;flex-wrap:wrap}
  .pill{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:6px 12px;font-size:13px}
  .wrap{max-width:640px;margin:-64px auto 40px;padding:0 20px}
  .card{background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 20px 50px -20px rgba(11,61,145,.35);padding:26px}
  .steps{display:flex;gap:8px;margin-bottom:22px}
  .steps .s{flex:1;height:6px;border-radius:999px;background:#e6ebf3;transition:background .3s}
  .steps .s.active{background:var(--brand-2)}
  .steps .s.done{background:var(--accent)}
  h2{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}
  .sub{color:var(--muted);font-size:14px;margin:0 0 20px}
  label{display:block;font-size:13px;font-weight:600;color:#33445c;margin:14px 0 6px}
  input,select{width:100%;border:1px solid #cdd7e6;border-radius:11px;padding:12px 13px;font-size:15px;font-family:inherit;color:var(--ink);background:#fff;transition:border-color .15s,box-shadow .15s}
  input:focus,select:focus{outline:none;border-color:var(--brand-2);box-shadow:0 0 0 4px rgba(30,99,208,.15)}
  .row{display:flex;gap:12px}
  .row>div{flex:1}
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
  .offer .big{background:linear-gradient(120deg,#eef4ff,#e9fbf7);padding:20px;text-align:center}
  .offer .big .amt{font-size:34px;font-weight:800;color:var(--brand)}
  .offer .big .lbl{font-size:13px;color:var(--muted)}
  .offer .grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line)}
  .offer .grid div{background:#fff;padding:14px 16px}
  .offer .grid .k{font-size:12px;color:var(--muted)} .offer .grid .v{font-size:17px;font-weight:700;margin-top:2px}
  .ai{background:#f2f7ff;border:1px solid #dbe7fb;border-radius:12px;padding:13px 14px;font-size:13.5px;color:#274060;margin-top:14px}
  .ai b{color:var(--brand)}
  .terms{background:#f7f9fc;border:1px solid var(--line);border-radius:12px;padding:14px;font-size:13px;color:var(--muted);max-height:150px;overflow:auto;margin:14px 0}
  .check{display:flex;gap:10px;align-items:flex-start;font-size:14px;margin-top:12px}
  .check input{width:18px;height:18px;margin-top:2px}
  .foot{max-width:1080px;margin:0 auto;padding:24px;color:#8a99ad;font-size:12px;text-align:center}
  .err{background:#fdeaea;color:#991b1b;border:1px solid #f6caca;border-radius:10px;padding:10px 12px;font-size:13px;margin-top:12px}
</style>
</head>
<body>
  <header class="top"><div class="top-inner">
    <div class="logo"><span class="mark">✦</span> Banco del Futuro</div>
    <nav><span>Cuentas</span><span>Tarjetas</span><span>Préstamos</span><span>Ayuda</span></nav>
  </div></header>
  <section class="hero"><div class="hero-inner">
    <h1>Tu préstamo personal, aprobado con IA en minutos.</h1>
    <p>Completá la solicitud y nuestro analista de crédito inteligente evalúa tu perfil al instante. Sin filas, sin papeleo.</p>
    <div class="pills"><span class="pill">🔒 Conexión segura</span><span class="pill">⚡ Respuesta inmediata</span><span class="pill">🤖 Evaluación con IA</span></div>
  </div></section>

  <main class="wrap"><div class="card" id="card"></div>
    <div class="secure">🔒 Tus datos viajan cifrados. Banco del Futuro no comparte tu información.</div>
  </main>
  <footer class="foot">Banco del Futuro · Demo · Powered by Neuratek Cassiopeia</footer>

<script>
(function(){
  var TOKEN="%TOKEN%";
  var card=document.getElementById("card");
  var state={appId:null,offer:null,poll:null};
  var money=function(n){ if(n==null||isNaN(n))return "—"; return new Intl.NumberFormat("es",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(n); };

  function steps(active,done){
    var s="";for(var i=1;i<=3;i++){var c="s";if(i<done||done==="all")c+=" done";else if(i===active)c+=" active";s+='<div class="'+c+'"></div>';}
    return '<div class="steps">'+s+'</div>';
  }
  function esc(x){return String(x==null?"":x).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];});}

  function screenForm(){
    card.innerHTML = steps(1,1) +
      '<h2>Solicitá tu préstamo</h2><p class="sub">Contanos un poco sobre vos. Toma menos de un minuto.</p>'+
      '<form id="f">'+
      '<label>Nombre completo</label><input name="fullName" required placeholder="Ada Lovelace" />'+
      '<label>Email</label><input name="email" type="email" required placeholder="vos@email.com" />'+
      '<div class="row"><div><label>Ingreso anual (USD)</label><input name="annualIncome" type="number" min="0" required placeholder="120000" /></div>'+
      '<div><label>Monto solicitado (USD)</label><input name="amount" type="number" min="1000" required placeholder="20000" /></div></div>'+
      '<div class="row"><div><label>Plazo (años)</label><input name="termYears" type="number" min="1" max="30" value="5" required /></div>'+
      '<div><label>Situación laboral</label><select name="employmentStatus" required><option value="employed">En relación de dependencia</option><option value="self">Independiente</option><option value="unemployed">Desempleado</option></select></div></div>'+
      '<button class="btn" type="submit">Solicitar préstamo →</button>'+
      '<div id="ferr"></div></form>';
    document.getElementById("f").addEventListener("submit",submit);
  }

  function submit(e){
    e.preventDefault();
    var fd=new FormData(e.target), data={};
    fd.forEach(function(v,k){ data[k]=(k==="annualIncome"||k==="amount"||k==="termYears")?Number(v):v; });
    screenAnalyzing();
    fetch("/apply/"+TOKEN,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)})
      .then(function(r){return r.json();})
      .then(function(res){ if(res.ok===false)throw new Error(res.error||"Error"); state.appId=res.appId; route(res); })
      .catch(function(err){ screenError(err.message); });
  }

  function screenAnalyzing(){
    card.innerHTML = steps(1,1) + '<div class="center"><div class="spinner"></div><h2>Analizando tu solicitud…</h2><p class="sub">Nuestro analista de crédito con IA está evaluando tu perfil.</p></div>';
  }
  function screenReview(){
    card.innerHTML = steps(2,1) + '<div class="center"><div class="spinner"></div><span class="badge rev">⏳ En revisión</span><h2 style="margin-top:14px">Un especialista está revisando tu solicitud</h2><p class="sub">Tu caso requiere una revisión adicional. Te mostramos el resultado apenas esté listo — no cierres esta página.</p></div>';
    if(!state.poll){ state.poll=setInterval(pollStatus,3000); }
  }
  function pollStatus(){
    fetch("/apply/"+TOKEN+"/"+state.appId).then(function(r){return r.json();}).then(function(res){
      if(res.stage!=="review"){ clearInterval(state.poll); state.poll=null; route(res); }
    }).catch(function(){});
  }

  function route(res){
    if(res.stage==="offer"){ state.offer=res.offer; screenOffer(res.offer); }
    else if(res.stage==="review"){ screenReview(); }
    else if(res.stage==="approved"){ screenApproved(res.offer); }
    else if(res.stage==="declined"){ screenDeclined(res.offer); }
    else if(res.stage==="processing"){ setTimeout(function(){ fetch("/apply/"+TOKEN+"/"+state.appId).then(function(r){return r.json();}).then(route); },1500); }
    else { screenError("No pudimos procesar tu solicitud."); }
  }

  function screenOffer(o){
    var reason = o&&o.reasoning ? '<div class="ai">🤖 <b>Análisis de crédito (IA):</b> '+esc(o.reasoning)+(o.creditScore!=null?' · Score: <b>'+esc(o.creditScore)+'</b>':'')+'</div>' : '';
    card.innerHTML = steps(2,1) +
      '<span class="badge ok">✓ ¡Pre-aprobado!</span>'+
      '<h2 style="margin-top:12px">Tu oferta está lista</h2><p class="sub">Revisá las condiciones de tu préstamo personal.</p>'+
      '<div class="offer"><div class="big"><div class="amt">'+money(o&&o.amount)+'</div><div class="lbl">Monto del préstamo</div></div>'+
      '<div class="grid"><div><div class="k">Cuota mensual estimada</div><div class="v">'+money(o&&o.monthlyPayment)+'</div></div>'+
      '<div><div class="k">Plazo</div><div class="v">'+esc(o&&o.termYears)+' años</div></div></div></div>'+
      reason +
      '<button class="btn" id="acc">Aceptar condiciones →</button>'+
      '<button class="btn ghost" id="decl" style="margin-top:10px">Ahora no</button>';
    document.getElementById("acc").addEventListener("click",screenSign);
    document.getElementById("decl").addEventListener("click",screenForm);
  }

  function screenSign(){
    var o=state.offer||{};
    card.innerHTML = steps(3,2) +
      '<h2>Firmá tu préstamo</h2><p class="sub">Último paso: confirmá que aceptás las condiciones.</p>'+
      '<div class="offer"><div class="grid" style="grid-template-columns:1fr 1fr">'+
      '<div><div class="k">Monto</div><div class="v">'+money(o.amount)+'</div></div>'+
      '<div><div class="k">Cuota mensual</div><div class="v">'+money(o.monthlyPayment)+'</div></div>'+
      '<div><div class="k">Plazo</div><div class="v">'+esc(o.termYears)+' años</div></div>'+
      '<div><div class="k">Tasa</div><div class="v">6,0% anual</div></div></div></div>'+
      '<div class="terms">Al firmar, aceptás el contrato de préstamo personal de Banco del Futuro, incluyendo el cronograma de pagos, la tasa nominal anual del 6% y las condiciones generales. Esta es una demostración; no se genera ninguna obligación real.</div>'+
      '<label class="check"><input type="checkbox" id="ok" /> He leído y acepto los términos y condiciones del préstamo.</label>'+
      '<button class="btn" id="sign" disabled>Firmar y finalizar</button>'+
      '<button class="btn ghost" id="back" style="margin-top:10px">Volver</button><div id="serr"></div>';
    var ok=document.getElementById("ok"), btn=document.getElementById("sign");
    ok.addEventListener("change",function(){ btn.disabled=!ok.checked; });
    document.getElementById("back").addEventListener("click",function(){ screenOffer(state.offer); });
    btn.addEventListener("click",function(){
      btn.disabled=true; btn.textContent="Firmando…";
      fetch("/apply/"+TOKEN+"/"+state.appId+"/accept",{method:"POST"}).then(function(r){return r.json();})
        .then(function(res){ if(res.ok===false)throw new Error(res.error||"Error"); route(res); })
        .catch(function(err){ document.getElementById("serr").innerHTML='<div class="err">'+esc(err.message)+'</div>'; btn.disabled=false; btn.textContent="Firmar y finalizar"; });
    });
  }

  function screenApproved(o){
    card.innerHTML = steps(3,"all") +
      '<div class="center"><div style="font-size:52px">🎉</div><span class="badge ok">✓ Préstamo aprobado</span>'+
      '<h2 style="margin-top:14px">¡Felicitaciones!</h2><p class="sub">Tu préstamo de '+money(o&&o.amount)+' fue aprobado y firmado. El dinero se acreditará en tu cuenta en las próximas horas.</p>'+
      '<button class="btn" onclick="location.reload()" style="max-width:260px;margin:8px auto 0">Nueva solicitud</button></div>';
  }
  function screenDeclined(){
    card.innerHTML = steps(2,1) +
      '<div class="center"><span class="badge bad">Solicitud no aprobada</span>'+
      '<h2 style="margin-top:14px">No pudimos aprobar tu préstamo</h2><p class="sub">Según nuestra evaluación, en este momento no podemos ofrecerte este préstamo. Podés volver a intentarlo más adelante.</p>'+
      '<button class="btn ghost" onclick="location.reload()" style="max-width:260px;margin:8px auto 0">Volver al inicio</button></div>';
  }
  function screenError(msg){
    card.innerHTML = steps(1,1) + '<div class="center"><h2>Ups…</h2><p class="sub">'+esc(msg)+'</p><button class="btn ghost" onclick="location.reload()" style="max-width:260px;margin:0 auto">Reintentar</button></div>';
  }

  screenForm();
})();
</script>
</body>
</html>`;
