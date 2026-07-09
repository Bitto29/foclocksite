// ===== DATA =====
var D = {
  sess: JSON.parse(localStorage.getItem('fl_s')||'[]'),
  xp: +localStorage.getItem('fl_xp')||0,
  ach: JSON.parse(localStorage.getItem('fl_a')||'{}'),
  subj: JSON.parse(localStorage.getItem('fl_sj')||'["Mathematics","Physics","Chemistry","Biology","English","History"]'),
  rems: JSON.parse(localStorage.getItem('fl_r')||'[]'),
  goal: +localStorage.getItem('fl_g')||120,
  theme: localStorage.getItem('fl_th')||'dark',
  name: localStorage.getItem('fl_nm')||'',
  streak: JSON.parse(localStorage.getItem('fl_st')||'{"c":0,"d":""}'),
  lock: localStorage.getItem('fl_lk') !== '0'
};

var CUR = null;
var STMR = null, PNTMR = null, REMTMR = null, WL = null;
var ACTX = null, ANODES = {}, CURNAMB = null, CURLOFI = null, CUR_LOFI_INDEX = 0;
var PCHART = null, PERIOD = 'week';
var SUBJ_PERIOD = 'all', SUBJ_FROM = '', SUBJ_TO = '';
var MANS = 0, SELSUBJ = '', SELT = 30, SESS_SUBJS = [];
var THEME_MQ = window.matchMedia('(prefers-color-scheme: dark)');

function getSessionElapsed(now){
  if(!CUR) return 0;
  now = now || Date.now();
  var base = safeNum(CUR.elapsed, 0);
  if(CUR.paused) return base;
  return base + Math.max(0, Math.floor((now - safeNum(CUR.savedAt, now)) / 1000));
}
function saveSessionState(){
  if(!CUR) return;
  localStorage.setItem('fl_cur', JSON.stringify({
    id: CUR.id || uid(),
    subj: CUR.subj || 'General',
    timed: !!CUR.timed,
    total: safeNum(CUR.total, 0),
    elapsed: safeNum(CUR.elapsed, 0),
    savedAt: safeNum(CUR.savedAt, Date.now()),
    paused: !!CUR.paused,
    xp: safeNum(CUR.xp, 0),
    lock: !!CUR.lock,
    createdAt: safeNum(CUR.createdAt, Date.now())
  }));
}
function clearSessionState(){ localStorage.removeItem('fl_cur'); }
function syncReminderLoop(){
  clearInterval(REMTMR); clearInterval(PNTMR);
  if(!CUR) return;
  if(CUR.paused){
    PNTMR = setInterval(function(){ notifyApp('Foc Lock','Session paused. Get back to studying!',{tag:'paused-reminder',requireInteraction:true}); }, 300000);
    return;
  }
  REMTMR = setInterval(function(){
    notifyApp('Foc Lock', CUR.lock ? 'Stay focused. Your session is still running.' : 'Study check-in: are you still studying?', {tag:'study-check',requireInteraction:false});
  }, 300000);
}
function restoreSessionState(){
  var raw = localStorage.getItem('fl_cur');
  if(!raw) return;
  try{
    var s = JSON.parse(raw);
    if(!s||!s.subj){ clearSessionState(); return; }
    CUR = {
      id: s.id||uid(), subj: s.subj||'General', timed: !!s.timed,
      total: safeNum(s.total,0), elapsed: safeNum(s.elapsed,0),
      savedAt: safeNum(s.savedAt,Date.now()), paused: !!s.paused,
      xp: safeNum(s.xp,0), lock: s.lock===true, createdAt: safeNum(s.createdAt,Date.now())
    };
    document.getElementById('sess').classList.add('active');
    document.getElementById('s-subj').textContent = CUR.subj;
    document.getElementById('s-mode').textContent = CUR.timed ? (Math.round(CUR.total/60)+' min session'+(CUR.lock?' • Fullscreen lock':' • Relaxed mode')) : ('Open session'+(CUR.lock?' • Fullscreen lock':' • Relaxed mode'));
    document.getElementById('s-status').textContent = CUR.paused ? 'Paused' : 'In Progress';
    document.getElementById('btn-pause').style.display = CUR.paused ? 'none' : 'flex';
    document.getElementById('btn-resume').style.display = CUR.paused ? 'flex' : 'none';
    document.getElementById('btn-end').style.display = CUR.paused ? 'flex' : 'none';
    if(CUR.lock) enterFullscreenMode();
    syncReminderLoop(); updTDisp(); updateSessionXPDisplay(); setSessionFullscreenUI(); updateSessionMusicUI();
    if(CUR.timed && getSessionElapsed() >= CUR.total){ CUR.el = getSessionElapsed(); endSess(true); return; }
    scheduleCloudSave();
    STMR = setInterval(tick, 1000);
  }catch(e){ clearSessionState(); CUR = null; }
}

// ===== SUPABASE =====
var SUPABASE_URL = 'https://qwmontyymrygxwanmxcy.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3bW9udHl5bXJ5Z3h3YW5teGN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4OTgxODAsImV4cCI6MjA5NDQ3NDE4MH0.vh8n6V8uPSqahOFALElbzM24D6fR2bfAaP-PZqKrxiE';
var SB = null;
var AUTH = { user: null, session: null, ready: false, mode: 'signin', syncing: false };
var CLOUD_TIMER = null;
var CLOUD_READY = false;

function uid(){ if(window.crypto&&crypto.randomUUID) return crypto.randomUUID(); return 'id-'+Date.now()+'-'+Math.random().toString(16).slice(2); }
function safeNum(v,fallback){ v=parseInt(v,10); return isNaN(v)?fallback:v; }

function ensureDefaults(){
  if(!Array.isArray(D.sess)) D.sess=[];
  if(!Array.isArray(D.subj)||!D.subj.length) D.subj=['Mathematics','Physics','Chemistry','Biology','English','History'];
  if(!Array.isArray(D.rems)) D.rems=[];
  if(!D.ach||typeof D.ach!=='object') D.ach={};
  if(!D.streak||typeof D.streak!=='object') D.streak={c:0,d:''};
  if(!D.goal) D.goal=120;
  if(D.theme!=='dark'&&D.theme!=='light') D.theme='dark';
  if(typeof D.lock!=='boolean') D.lock=true;

  D.sess=D.sess.map(function(s){
    return {
      id:s.id||uid(),
      subj:s.subj||'General',
      dur:safeNum(s.dur,0),
      d:s.d||today(),
      done:s.done!==false,
      ts:safeNum(s.ts,Date.now()),
      xp:safeNum(s.xp,Math.max(0,Math.floor(safeNum(s.dur,0)/60))),
      manual:!!s.manual
    };
  }).sort(function(a,b){ return safeNum(a.ts,0)-safeNum(b.ts,0); });

  D.rems=D.rems.map(function(r){
    return {id:r.id||uid(),t:r.t||'08:00',l:r.l||'Study Time',on:r.on!==false,_lastHit:r._lastHit||''};
  });
}

function calcXP(){ return D.sess.reduce(function(s,r){ return s+(typeof r.xp==='number'?r.xp:Math.max(0,Math.floor(safeNum(r.dur,0)/60))); },0); }

function cloneCloudState(){
  var state = {
    sess:D.sess,
    xp:D.xp,
    ach:D.ach,
    subj:D.subj,
    rems:D.rems,
    goal:D.goal,
    theme:D.theme,
    name:D.name,
    streak:D.streak,
    lock:D.lock
  };
  try{ return JSON.parse(JSON.stringify(state)); }
  catch(e){ return state; }
}
function cloneState(){ return cloneCloudState(); }

function persistLocal(){
  D.xp=calcXP();
  localStorage.setItem('fl_s',JSON.stringify(D.sess));
  localStorage.setItem('fl_xp',D.xp);
  localStorage.setItem('fl_a',JSON.stringify(D.ach));
  localStorage.setItem('fl_sj',JSON.stringify(D.subj));
  localStorage.setItem('fl_r',JSON.stringify(D.rems));
  localStorage.setItem('fl_g',D.goal);
  localStorage.setItem('fl_th',D.theme);
  localStorage.setItem('fl_lk',D.lock?'1':'0');
  if((D.name||'').trim()) localStorage.setItem('fl_nm',D.name.trim());
  else localStorage.removeItem('fl_nm');
  localStorage.setItem('fl_st',JSON.stringify(D.streak));
}

function uniqueStrings(list){ var seen={}; return list.filter(function(v){ if(!v||seen[v]) return false; seen[v]=true; return true; }); }
function mergeByKey(remoteArr,localArr,keyFn){ var seen={}; var out=[]; [remoteArr||[],localArr||[]].forEach(function(arr){ arr.forEach(function(item){ var key=keyFn(item); if(!seen[key]){ seen[key]=true; out.push(item); } }); }); return out; }
function mergeStreak(a,b){ a=a&&typeof a==='object'?a:{c:0,d:''}; b=b&&typeof b==='object'?b:{c:0,d:''}; a.c=safeNum(a.c,0); b.c=safeNum(b.c,0); a.d=a.d||''; b.d=b.d||''; if(!a.d)return b; if(!b.d)return a; if(a.d>b.d)return a; if(b.d>a.d)return b; return a.c>=b.c?a:b; }
function pickScalar(rv,lv,def){ var lh=lv!==undefined&&lv!==null&&lv!==''; var rh=rv!==undefined&&rv!==null&&rv!==''; if(lh&&lv!==def)return lv; if(rh)return rv; return lh?lv:def; }
function getMetaName(user){ if(!user||!user.user_metadata)return''; return String(user.user_metadata.full_name||user.user_metadata.name||user.user_metadata.display_name||'').trim(); }
function currentDisplayName(){ return String(D.name||getMetaName(AUTH.user)||'').trim(); }
function syncNameFromAuth(){ var mn=getMetaName(AUTH.user); if(mn)D.name=mn; }
function saveDisplayName(name){
  name=String(name||'').trim();
  D.name=name;
  persistLocal();
  if(SB&&AUTH.user&&name){
    SB.auth.updateUser({data:{full_name:name,name:name,display_name:name}}).catch(function(){});
  }
  scheduleCloudSave();
  updateGreeting();
}
function setBlurState(on){ ['hdr','content','nav'].forEach(function(id){ var el=document.getElementById(id); if(el)el.classList.toggle('blur-bg',!!on); }); }
function greetingText(){ var h=new Date().getHours(); if(h<12)return'Good morning'; if(h<18)return'Good afternoon'; return'Good evening'; }
function updateGreeting(){
  var name=currentDisplayName();
  var el=document.getElementById('home-greeting');
  if(el) el.innerHTML=greetingText()+(name?', <span>'+name+'</span>':', <span>there</span>');
}
function mergeRems(remoteArr,localArr){
  var map={};
  function keyFor(r){ return r.id||[r.t||'',r.l||''].join('|'); }
  (remoteArr||[]).forEach(function(r){ map[keyFor(r)]=r; });
  (localArr||[]).forEach(function(r){
    var k=keyFor(r);
    var ex=map[k];
    if(ex){
      // Keep whichever _lastHit is more recent so a reminder that already fired
      // doesn't get "forgotten" and re-notify repeatedly after a cloud sync.
      var lastHit=(r._lastHit||'')>(ex._lastHit||'')?r._lastHit:ex._lastHit;
      map[k]=Object.assign({},ex,r,{_lastHit:lastHit||''});
    }else{
      map[k]=r;
    }
  });
  return Object.keys(map).map(function(k){return map[k];});
}
function mergeStates(remote){
  remote=remote&&remote.state?remote.state:remote;
  if(!remote||typeof remote!=='object')return;
  D.sess=mergeByKey(remote.sess||[],D.sess||[],function(s){ return s.id||[s.ts||0,s.d||'',s.subj||'',s.dur||0].join('|'); }).sort(function(a,b){ return safeNum(a.ts,0)-safeNum(b.ts,0); });
  D.rems=mergeRems(remote.rems||[],D.rems||[]);
  D.subj=uniqueStrings([].concat(remote.subj||[],D.subj||[]));
  D.ach=Object.assign({},remote.ach||{},D.ach||{});
  D.goal=pickScalar(remote.goal,D.goal,120);
  D.theme=pickScalar(remote.theme,D.theme,'dark');
  D.name=pickScalar(remote.name,D.name,'');
  D.streak=mergeStreak(remote.streak,D.streak);
  if(typeof remote.lock==='boolean') D.lock=remote.lock;
  D.xp=calcXP();
  persistLocal();
}
function updateAuthUI(){
  var signed=!!AUTH.user;
  var email=signed?(AUTH.user.email||'Signed in'):'Not signed in';
  var displayName=currentDisplayName();
  var title=document.getElementById('auth-card-title');
  var nameBox=document.getElementById('auth-card-name');
  var sub=document.getElementById('auth-card-sub');
  var chip=document.getElementById('auth-card-chip');
  var btn=document.getElementById('auth-card-btn');
  var nameBtn=document.getElementById('auth-card-name-btn');
  var hdr=document.querySelector('#hdr .hdr-btns .ibtn');
  if(title)title.textContent=signed?(displayName||email):'Not signed in';
  if(nameBox)nameBox.textContent=signed?('Display name: '+(displayName||'Not set')):'No display name set';
  if(sub)sub.textContent=signed?'Your study data syncs across devices. Changes upload automatically when you are signed in.':'Sign in to sync your study data across devices. Local storage still works offline.';
  if(chip)chip.textContent=signed?(CLOUD_READY?'Cloud sync on':'Preparing cloud sync...'):'Local only';
  if(btn){ btn.textContent=signed?'Sign Out':'Sign In'; btn.onclick=signed?signOut:openAuth; }
  if(nameBtn)nameBtn.style.display=signed?'inline-flex':'none';
  if(hdr){ hdr.title=signed?('Account: '+email):'Account & sync'; hdr.style.color=signed?'var(--success)':''; }
  var mt=document.getElementById('auth-modal-title');
  if(mt)mt.textContent=AUTH.mode==='signup'?'Create your account':'Sign in to your account';
  var submit=document.getElementById('auth-submit');
  if(submit)submit.textContent=AUTH.mode==='signup'?'Create Account':'Sign In';
  var help=document.getElementById('auth-help');
  if(help)help.textContent=signed?'Your study data syncs across devices.':'Sign in to sync your study data across devices.';
  var err=document.getElementById('auth-error');
  if(err)err.style.display='none';
  var st=document.getElementById('auth-tab-signin');
  var sup=document.getElementById('auth-tab-signup');
  if(st)st.classList.toggle('active',AUTH.mode==='signin');
  if(sup)sup.classList.toggle('active',AUTH.mode==='signup');
  var p2=document.getElementById('auth-pass2-wrap');
  if(p2)p2.style.display=AUTH.mode==='signup'?'block':'none';
  var ni=document.getElementById('auth-name');
  if(ni){ ni.style.display=AUTH.mode==='signup'?'block':'none'; ni.required=AUTH.mode==='signup'; }
}
function setAuthMode(mode){
  AUTH.mode=mode==='signup'?'signup':'signin';
  updateAuthUI();
  var ni=document.getElementById('auth-name');
  if(ni){ if(AUTH.mode==='signup')ni.value=currentDisplayName(); else ni.value=''; }
}
function openAuth(){
  AUTH.mode=AUTH.mode||'signin'; updateAuthUI();
  setBlurState(true); document.getElementById('auth-modal').classList.add('open');
  var ni=document.getElementById('auth-name');
  if(ni&&AUTH.mode==='signup')ni.value=currentDisplayName();
  var em=document.getElementById('auth-email'); if(em)em.focus();
}
function closeAuth(){ document.getElementById('auth-modal').classList.remove('open'); setBlurState(false); }
function showAuthError(msg){ var err=document.getElementById('auth-error'); if(!err)return; err.textContent=msg; err.style.display=msg?'block':'none'; }
function openNameEditor(){
  var current=currentDisplayName();
  var next=prompt('Enter your display name:',current);
  if(next===null)return;
  next=String(next||'').trim();
  if(!next){ toast('Name cannot be empty.'); return; }
  saveDisplayName(next); syncNameFromAuth(); updateAuthUI(); updateGreeting(); scheduleCloudSave(); toast('Name updated');
}
function togglePasswordVisibility(id,btn){
  var inp=document.getElementById(id); if(!inp)return;
  var show=inp.type==='password'; inp.type=show?'text':'password';
  if(btn){ btn.setAttribute('aria-label',show?'Hide password':'Show password'); btn.setAttribute('title',show?'Hide password':'Show password'); btn.innerHTML=show?'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.97 10.97 0 0 1 12 20c-7 0-11-8-11-8a21.67 21.67 0 0 1 5.17-6.11M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a21.74 21.74 0 0 1-4.14 5.14M1 1l22 22"/></svg>':'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>'; }
}
function queueCloudSave(delay){ if(!AUTH.user||!AUTH.ready)return; clearTimeout(CLOUD_TIMER); CLOUD_TIMER=setTimeout(saveCloud, typeof delay==='number'?delay:900); }
function scheduleCloudSave(){ queueCloudSave(900); }
async function flushCloudSave(){
  clearTimeout(CLOUD_TIMER);
  await saveCloud(true);
}
async function saveCloud(force){
  if(!SB||!AUTH.user||AUTH.syncing)return false;
  if(!AUTH.ready&&!force)return false;
  AUTH.syncing=true;
  try{
    var payload=cloneCloudState();
    var res=await SB.from('study_tracking_profiles').upsert({
      user_id:AUTH.user.id,
      email:AUTH.user.email,
      state:payload,
      updated_at:new Date().toISOString()
    },{onConflict:'user_id'});
    if(res&&res.error)throw res.error;
    CLOUD_READY=true;
    updateCloudStatus('Synced to cloud');
    return true;
  }catch(e){
    CLOUD_READY=false;
    updateCloudStatus('Cloud sync failed');
    return false;
  }finally{
    AUTH.syncing=false;
  }
}
function normalizeRemoteState(raw){
  var remote = raw && raw.state ? raw.state : raw;
  if(!remote || typeof remote !== 'object') return null;
  return remote;
}
async function loadCloud(){
  if(!SB||!AUTH.user)return;
  updateCloudStatus('Loading cloud data...');
  try{
    var res=await SB.from('study_tracking_profiles').select('state,updated_at').eq('user_id',AUTH.user.id).maybeSingle();
    if(res&&res.error)throw res.error;
    if(res&&res.data&&res.data.state){
      mergeStates(normalizeRemoteState(res.data.state));
    }else{
      persistLocal();
    }
    await saveCloud(true);
    refreshDerivedAndUI();
    CLOUD_READY=true;
    updateCloudStatus('Synced');
  }catch(e){
    CLOUD_READY=false;
    updateCloudStatus('Offline');
    refreshDerivedAndUI();
  }
}
function updateCloudStatus(text){
  var chip=document.getElementById('auth-card-chip');
  if(!chip)return;
  chip.textContent=AUTH.user?(text||'Cloud sync on'):'Local only';
}
function refreshDerivedAndUI(){
  D.xp=calcXP(); persistLocal(); updateGreeting(); updHome(); renderSubjList(); renderRems(); renderBadges(); renderGoals(); updXP();
  if(PCHART)updChart();
  if(document.getElementById('scr-progress').classList.contains('active')){ updSBars(); updHist(); updDayChart(); }
  updateAuthUI();
  renderFriendsLeaderboard();
  var btn=document.getElementById('auth-card-btn');
  if(btn){ btn.textContent=AUTH.user?'Sign Out':'Sign In'; }
}
async function bootSupabase(){
  if(!(window.supabase&&window.supabase.createClient)){
    AUTH.ready=true;
    CLOUD_READY=false;
    updateAuthUI();
    return;
  }
  SB=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{
    auth:{
      persistSession:true,
      autoRefreshToken:true,
      detectSessionInUrl:false,
      storage:window.localStorage,
      storageKey:'foc-lock-auth'
    }
  });
  try{
    var sess=await SB.auth.getSession();
    AUTH.session=sess&&sess.data?sess.data.session:null;
    AUTH.user=AUTH.session?AUTH.session.user:null;
    syncNameFromAuth();
  }catch(e){}
  AUTH.ready=true;
  CLOUD_READY=!!AUTH.user;
  updateAuthUI();

  if(AUTH.user) await loadCloud();

  SB.auth.onAuthStateChange(async function(event,session){
    AUTH.session=session;
    AUTH.user=session?session.user:null;
    syncNameFromAuth();
    CLOUD_READY=!!AUTH.user;
    updateAuthUI();

    if(AUTH.user){
      if(event==='SIGNED_IN' || event==='INITIAL_SESSION' || event==='TOKEN_REFRESHED'){
        await loadCloud();
        loadNotes();
        focoLoadSessions();
      }else{
        updateCloudStatus('Cloud sync on');
      }
      toast(event==='INITIAL_SESSION'?'Session restored':'Signed in');
    } else {
      updateCloudStatus('Local only');
      NOTES=[]; FOCO_SESSIONS=[];
      renderNotes();
      toast('Signed out');
    }
  });

  window.addEventListener('beforeunload', function(){ if(AUTH.user) saveCloud(true); });
  window.addEventListener('pagehide', function(){ if(AUTH.user) saveCloud(true); });
  window.addEventListener('online', function(){
    if(AUTH.user){ CLOUD_READY=true; updateAuthUI(); queueCloudSave(300); }
  });
}
async function submitAuth(){
  var email=document.getElementById('auth-email').value.trim();
  var displayName=document.getElementById('auth-name').value.trim();
  var password=document.getElementById('auth-pass').value;
  var pass2=document.getElementById('auth-pass2').value;
  if(!SB){ showAuthError('Supabase client is not available.'); return; }
  if(!email||!password){ showAuthError('Enter your email and password.'); return; }
  if(AUTH.mode==='signup'&&!displayName){ showAuthError('Please enter your name.'); return; }
  if(AUTH.mode==='signup'&&password!==pass2){ showAuthError('Passwords do not match.'); return; }
  showAuthError('');
  try{
    if(AUTH.mode==='signup'){
      var signUp=await SB.auth.signUp({email:email,password:password,options:{data:{full_name:displayName,name:displayName,display_name:displayName}}});
      if(signUp.error)throw signUp.error;
      if(signUp.data&&signUp.data.session){
        AUTH.user=signUp.data.session.user;
        AUTH.session=signUp.data.session;
        CLOUD_READY=true;
        saveDisplayName(displayName);
        syncNameFromAuth();
        await loadCloud();
        toast('Account created');
        closeAuth();
      } else {
        toast('Check your email to finish sign up');
      }
    } else {
      var signIn=await SB.auth.signInWithPassword({email:email,password:password});
      if(signIn.error)throw signIn.error;
      AUTH.user=signIn.data.user;
      AUTH.session=signIn.data.session;
      CLOUD_READY=true;
      syncNameFromAuth();
      await loadCloud();
      toast('Signed in');
      closeAuth();
    }
  }catch(e){
    showAuthError(e.message||'Authentication failed.');
  }
}
async function signOut(){ if(!SB)return; try{ await SB.auth.signOut(); }catch(e){} }

// ===== INIT =====
function init(){
  ensureDefaults(); persistLocal(); applyTheme(D.theme);
  document.getElementById('goal-inp').value=D.goal;
  document.getElementById('date-disp').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  updHome(); updateGreeting(); renderSubjList(); renderRems(); renderBadges(); renderGoals(); updXP();
  initChart(); renderLofi(); renderBengaliStations(); updateSessionMusicUI();
  document.getElementById('daily-tip').textContent=getTip();
  document.getElementById('sug-routine').textContent=getRoutine();
  checkRems(); setInterval(checkRems,60000);
  initNotifServiceWorker();
  document.addEventListener('visibilitychange',onVis);
  restoreSessionState(); bootSupabase(); updateAuthUI();
  renderFriendsLeaderboard();
  if('Notification' in window && Notification.permission==='default'){
    setTimeout(function(){ ensureBrowserNotifications(); },1500);
  }
  if(THEME_MQ.addEventListener)THEME_MQ.addEventListener('change',onSystemThemeChange);
  else if(THEME_MQ.addListener)THEME_MQ.addListener(onSystemThemeChange);
}

// ===== THEME =====
function syncThemeUI(){
  var mode=D.theme==='light'?'light':'dark';
  var app=document.getElementById('app');
  if(app)app.setAttribute('data-theme',mode);
  document.documentElement.style.colorScheme=mode;
  document.querySelectorAll('.theme-opt').forEach(function(btn){ btn.classList.toggle('active',btn.dataset.mode===mode); });
}
function applyTheme(t){
  if(t!=='dark'&&t!=='light')t='dark';
  D.theme=t;
  localStorage.setItem('fl_th',t);
  scheduleCloudSave();
  syncThemeUI();
  // Refresh chart colors when theme switches
  if(PCHART){ PCHART.data=getChartData(); PCHART.update(); }
}
function setThemeMode(mode){
  applyTheme(mode);
  toast(mode==='dark'?'Dark theme enabled':'Light theme enabled');
}
function onSystemThemeChange(){ }

// ===== NAV =====
var _prevTab = 'home'; // track previous tab for back navigation from More
function goScr(n,el,_skipHistory){
  var prev = _currentTab();
  document.querySelectorAll('.scr').forEach(function(s){s.classList.remove('active');});
  document.querySelectorAll('.ni').forEach(function(i){i.classList.remove('active');});
  var target=document.getElementById('scr-'+n);
  if(target){ target.classList.add('active'); }
  if(el)el.classList.add('active');
  else { var ni=document.querySelector('.ni[onclick*=\''+n+'\']'); if(ni)ni.classList.add('active'); }
  if(n==='progress'){updChart();updSBars();updHist();requestAnimationFrame(function(){updDayChart();});}
  if(n==='rewards'){renderBadges();updXP();renderGoals();renderFriendsLeaderboard();}
  if(n==='home'){updHome();}
  var contentEl=document.getElementById('content');
  if(contentEl)contentEl.scrollTop=0;
  if(!_skipHistory){
    if(prev && prev!==n) _prevTab=prev;
    history.pushState({type:'tab',tab:n},'','');
  }
}


function gSub(id,_skipHistory){
  var prevSub = _currentSub();
  document.querySelectorAll('#scr-more .subp').forEach(function(s){s.classList.remove('active');});
  var el=document.getElementById(id); if(el)el.classList.add('active');
  var contentElSub=document.getElementById('content');
  if(contentElSub)contentElSub.scrollTop=0;
  if(!_skipHistory){
    if(id==='more-main'){
      // going back to more-main — don't push, this IS the back action
      history.pushState({type:'tab',tab:'more',sub:'more-main'},'','');
    } else {
      history.pushState({type:'sub',sub:id},'','');
    }
  }
}
function _currentTab(){
  var active=document.querySelector('.scr.active');
  return active ? active.id.replace('scr-','') : 'home';
}
function _currentSub(){
  var active=document.querySelector('#scr-more .subp.active');
  return active ? active.id : 'more-main';
}
// Handle browser back (Android back button, Alt+Left, mouse back)
window.addEventListener('popstate',function(e){
  var s=e.state;

  /* 1. Foco history sidebar */
  var focosb=document.getElementById('foco-sidebar');
  if(focosb&&focosb.classList.contains('open')){
    focoSidebarClose(); history.pushState(s,'',''); return;
  }
  /* 2. Session Foco overlay */
  var sfoco=document.getElementById('sess-foco-overlay');
  if(sfoco&&sfoco.classList.contains('open')){
    sfoco.classList.remove('open'); history.pushState(s,'',''); return;
  }
  /* 3. PiP minimized — maximize back */
  if(SESS_MIN){ maximizeSess(); history.pushState(s,'',''); return; }

  /* 4. Other modals */
  var modals=['session-calc-modal','mgate','sm','auth-modal','manual-modal','edit-session-modal','friends-modal'];
  for(var i=0;i<modals.length;i++){
    var m=document.getElementById(modals[i]);
    if(m&&(m.classList.contains('open')||m.classList.contains('active'))&&m.id!=='sess'){
      if(modals[i]==='sm')closeSM();
      else if(modals[i]==='session-calc-modal')closeSessionCalc();
      else if(modals[i]==='mgate')closeMG();
      else if(modals[i]==='auth-modal')closeAuth();
      else if(modals[i]==='manual-modal')closeManualModal();
      else if(modals[i]==='edit-session-modal')closeEditModal();
      else if(modals[i]==='friends-modal')closeFriendsModal();
      history.pushState(s,'','');
      return;
    }
  }

  /* 5. Sub-page → back to more-main */
  if(!s){ goScr('home',null,true); return; }
  if(s.type==='sub'){
    goScr('more',null,true);
    gSub('more-main',true);
    return;
  }
  if(s.type==='tab'){
    if(s.sub&&s.sub==='more-main'){
      goScr('more',null,true); gSub('more-main',true);
    } else {
      goScr(s.tab,null,true);
    }
    return;
  }
  goScr('home',null,true);
});

// ===== PAGE SWIPE / ARROW NAV =====
var FOCO_TAB_ORDER=['home','progress','sounds','rewards','more'];

function focoNavSwipeBlocked(){
  // Don't hijack left/right when a modal, sidebar, session, or subpage is open —
  // only switch main tabs when we're actually looking at a top-level tab.
  var focosb=document.getElementById('foco-sidebar');
  if(focosb&&focosb.classList.contains('open'))return true;
  var sfoco=document.getElementById('sess-foco-overlay');
  if(sfoco&&sfoco.classList.contains('open'))return true;
  if(SESS_MIN)return true;
  var modals=['session-calc-modal','mgate','sm','auth-modal','manual-modal','edit-session-modal','friends-modal','kb-modal'];
  for(var i=0;i<modals.length;i++){
    var m=document.getElementById(modals[i]);
    if(m&&(m.classList.contains('open')||m.classList.contains('active')))return true;
  }
  if(CUR)return true; // active focus session showing — don't swipe away
  if(_currentTab()==='more'&&_currentSub()!=='more-main')return true; // inside a sub-page
  return false;
}

function focoStepTab(dir){
  var cur=_currentTab();
  var idx=FOCO_TAB_ORDER.indexOf(cur);
  if(idx===-1)idx=0;
  var next=idx+dir;
  if(next<0||next>=FOCO_TAB_ORDER.length)return; // no wraparound
  var n=FOCO_TAB_ORDER[next];
  goScr(n,document.querySelector('.ni[onclick*=\''+n+'\']'));
}

(function(){
  var touchStartX=0,touchStartY=0,touchActive=false;
  var content=document.getElementById('content');
  if(!content)return;
  content.addEventListener('touchstart',function(e){
    if(e.touches.length!==1)return;
    if(focoNavSwipeBlocked()){touchActive=false;return;}
    touchStartX=e.touches[0].clientX;
    touchStartY=e.touches[0].clientY;
    touchActive=true;
  },{passive:true});
  content.addEventListener('touchend',function(e){
    if(!touchActive)return;
    touchActive=false;
    var touch=e.changedTouches&&e.changedTouches[0];
    if(!touch)return;
    var dx=touch.clientX-touchStartX;
    var dy=touch.clientY-touchStartY;
    var absX=Math.abs(dx),absY=Math.abs(dy);
    var SWIPE_MIN=60; // px
    if(absX<SWIPE_MIN||absX<absY*1.5)return; // must be a mostly-horizontal, deliberate swipe
    if(focoNavSwipeBlocked())return;
    focoStepTab(dx<0?1:-1); // swipe left -> next tab, swipe right -> previous tab
  },{passive:true});
})();

// ===== MANUAL SESSION =====
function setManualDefaults(){
  var d=document.getElementById('man-date');
  var t=document.getElementById('man-time');
  if(d)d.value=today();
  if(t)t.value=pad(new Date().getHours())+':'+pad(new Date().getMinutes());
  var subj=document.getElementById('man-subj'); if(subj)subj.value='';
  var dur=document.getElementById('man-dur'); if(dur)dur.value='';
  renderManualChips();
}
function renderManualChips(){
  var c=document.getElementById('manual-chips'); if(!c)return;
  c.innerHTML='';
  (D.subj||[]).forEach(function(s){
    var d=document.createElement('div');
    d.className='chip'; d.style.cssText='flex-shrink:0;';
    d.textContent=s;
    d.onclick=function(){
      var mi=document.getElementById('man-subj');
      if(mi){ mi.value=s; mi.focus(); }
    };
    c.appendChild(d);
  });
}
function openManualSessionHome(){ setManualDefaults(); setBlurState(true); document.getElementById('manual-modal').classList.add('open'); }
function closeManualModal(){ document.getElementById('manual-modal').classList.remove('open'); setBlurState(false); }

// ===== HOME =====
function today(){ return new Date().toISOString().split('T')[0]; }
function updHome(){
  var t=today();
  var td=D.sess.filter(function(s){return s.d===t;});
  var tm=Math.round(td.reduce(function(a,s){return a+s.dur;},0)/60);
  updateGreeting();
  document.getElementById('s-today').textContent=fmtDur(tm);
  document.getElementById('s-streak').textContent=D.streak.c;
  document.getElementById('s-sess').textContent=D.sess.length;
  document.getElementById('s-xp').textContent=D.xp;
  var p=Math.min(100,Math.round(tm/D.goal*100));
  document.getElementById('daily-bar').style.width=p+'%';
  document.getElementById('daily-done').textContent=fmtDur(tm);
  document.getElementById('daily-goal-lbl').textContent='Goal: '+fmtDur(D.goal);
  var pctEl=document.getElementById('daily-pct'); if(pctEl)pctEl.textContent=p+'%';
  var ring=document.getElementById('daily-ring');
  if(ring)ring.style.strokeDashoffset=213.6*(1-p/100);
  renderRemPreview();
}

// ===== START MODAL =====
function openSM(){
  if(CUR){ toast('⚡ A session is already running!'); maximizeSess(); return; }
  SELSUBJ=''; SELT=30; SESS_SUBJS=[]; renderChips();
  document.querySelectorAll('.sm-dur-opt').forEach(function(o){o.classList.remove('sel');});
  var nto=document.getElementById('sm-notimer-opt'); if(nto)nto.classList.remove('sel');
  var first=document.querySelector('.sm-dur-opt[data-mins="30"]');
  if(first)first.classList.add('sel');
  document.getElementById('cust-t-wrap').style.display='none';
  document.getElementById('cust-subj').value='';
  var ts=document.getElementById('subj-type-sel'); if(ts)ts.value='';
  var st=document.getElementById('subj-tags'); if(st)st.innerHTML='';
  setBlurState(true); document.getElementById('sm').classList.add('open');
}
function closeSM(){ document.getElementById('sm').classList.remove('open'); setBlurState(false); }
function renderChips(){
  var c=document.getElementById('modal-chips'); c.innerHTML='';
  D.subj.forEach(function(s){
    var d=document.createElement('div');
    var alreadyAdded=SESS_SUBJS.some(function(x){return x.s===s;});
    d.className='chip'+(alreadyAdded?' sel':'');
    d.style.cssText='flex-shrink:0;'+(alreadyAdded?'opacity:.4;pointer-events:none;':'');
    d.textContent=s;
    d.onclick=function(){
      var ci=document.getElementById('cust-subj');
      if(ci){ ci.value=s; ci.focus(); }
    };
    c.appendChild(d);
  });
}

function addSubjTag(){
  var ci=document.getElementById('cust-subj');
  var ts=document.getElementById('subj-type-sel');
  var val=(ci?ci.value.trim():'');
  var typ=(ts?ts.value:'');
  if(!val){ toast('Enter a subject name'); return; }
  if(SESS_SUBJS.some(function(x){return x.s===val&&x.t===typ;})){
    toast('Already added'); ci.value=''; return;
  }
  SESS_SUBJS.push({s:val,t:typ});
  ci.value=''; if(ts)ts.value='';
  renderSubjTags(); renderChips(); ci.focus();
}

function renderSubjTags(){
  var wrap=document.getElementById('subj-tags'); if(!wrap)return;
  wrap.innerHTML='';
  SESS_SUBJS.forEach(function(obj,i){
    var tag=document.createElement('div'); tag.className='subj-tag';
    var nm=document.createElement('span'); nm.textContent=obj.s; tag.appendChild(nm);
    if(obj.t){
      var sep=document.createElement('span'); sep.textContent=' · '; sep.style.opacity='.4'; tag.appendChild(sep);
      var tp=document.createElement('span'); tp.className='stag-type'; tp.textContent=obj.t; tag.appendChild(tp);
    }
    var rm=document.createElement('button'); rm.className='rm-tag'; rm.textContent='×';
    rm.onclick=function(){ SESS_SUBJS.splice(i,1); renderSubjTags(); renderChips(); };
    tag.appendChild(rm); wrap.appendChild(tag);
  });
}
function selT(v,el){
  SELT=v;
  document.querySelectorAll('.sm-dur-opt').forEach(function(o){o.classList.remove('sel');});
  var nto=document.getElementById('sm-notimer-opt'); if(nto)nto.classList.remove('sel');
  if(el)el.classList.add('sel');
  document.getElementById('cust-t-wrap').style.display=v===-1?'block':'none';
}
function setSessionFullscreenUI(){ var btn=document.getElementById('fs-toggle-btn'); if(!btn)return; btn.textContent=(CUR&&CUR.lock)?'Exit Fullscreen':'Fullscreen'; }
async function enterFullscreenMode(){ try{ if(document.fullscreenElement==null&&document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); }catch(e){} await acqWL(); }
async function exitFullscreenMode(){ try{ if(document.fullscreenElement&&document.exitFullscreen) await document.exitFullscreen(); }catch(e){} relWL(); }
async function toggleSessionFullscreen(){
  if(!CUR)return;
  if(!CUR.lock){ CUR.lock=true; await enterFullscreenMode(); document.getElementById('s-mode').textContent=CUR.timed?(Math.round(CUR.total/60)+' min session • Fullscreen lock'):'Open session • Fullscreen lock'; toast('Fullscreen lock enabled.'); }
  else{ CUR.lock=false; await exitFullscreenMode(); document.getElementById('s-mode').textContent=CUR.timed?(Math.round(CUR.total/60)+' min session • Relaxed mode'):'Open session • Relaxed mode'; toast('Fullscreen lock disabled.'); }
  syncReminderLoop(); saveSessionState(); setSessionFullscreenUI();
}
function startSess(){
  /* Collect subjects — include anything still typed but not yet added */
  var custVal=document.getElementById('cust-subj').value.trim();
  var custType=(document.getElementById('subj-type-sel')||{}).value||'';
  if(custVal) SESS_SUBJS.push({s:custVal,t:custType});
  if(!SESS_SUBJS.length) SESS_SUBJS.push({s:'General',t:''});
  var subjs=SESS_SUBJS.map(function(x){return x.s;});
  /* Build display string: "Math · Online Class + Physics · Practicals" */
  var subj=SESS_SUBJS.map(function(x){return x.t?x.s+' · '+x.t:x.s;}).join(' + ');
  var subsubj=''; /* no longer used as a single field */
  var mins=SELT; if(mins===-1)mins=parseInt(document.getElementById('cust-t').value)||25;
  closeSM(); ensureBrowserNotifications();
  CUR={id:uid(),subj:subj,subjs:subjs,subjsDetail:SESS_SUBJS.slice(),timed:mins>0,total:mins*60,elapsed:0,savedAt:Date.now(),paused:false,xp:0,lock:false,createdAt:Date.now()};
  /* Display: "Math + Physics (Online Class)" */
  var dispSubj=subsubj?subj+' ('+subsubj+')':subj;
  document.getElementById('s-subj').textContent=dispSubj;
  document.getElementById('s-mode').textContent=mins>0?mins+' min session • Relaxed mode':'Open session • Relaxed mode';
  document.getElementById('sess').classList.add('active');
  document.getElementById('btn-pause').style.display='flex';
  document.getElementById('btn-resume').style.display='none';
  document.getElementById('btn-end').style.display='none';
  var sst=document.getElementById('s-status'); if(sst&&!CUR.paused)sst.textContent='In Progress';
  updateSessionXPDisplay(); syncReminderLoop(); saveSessionState(); updTDisp(); setSessionFullscreenUI();
  clearInterval(STMR); STMR=setInterval(tick,1000);
  notifyApp('Foc Lock','Session started. Stay focused!',{tag:'session-start',requireInteraction:false});
}
function tick(){
  if(!CUR||CUR.paused)return;
  var elapsed=getSessionElapsed(); CUR.el=elapsed; CUR.xp=Math.floor(elapsed/60);
  if(SESS_MIN){ updPipDisp(); } else { updTDisp(); }
  if(CUR.timed&&elapsed>=CUR.total)endSess(true);
}
function updateSessionXPDisplay(){
  if(!CUR)return;
  var earned=Math.floor(getSessionElapsed()/60);
  var totalXp=D.xp+earned;
  var le=document.getElementById('session-xp-live');
  var se=document.getElementById('session-xp-sub');
  if(le)le.textContent='Session XP: +'+earned+' XP';
  if(se)se.textContent='Total XP if ended now: '+totalXp+' XP';
}
function updTDisp(){
  if(!CUR)return;
  var elapsed=getSessionElapsed(); CUR.el=elapsed; CUR.xp=Math.floor(elapsed/60);
  var ds,p=0;
  if(CUR.timed){ ds=Math.max(0,CUR.total-elapsed); p=CUR.total?(elapsed/CUR.total):0; }
  else{ ds=elapsed; var ring0=document.getElementById('t-ring'); if(ring0)ring0.style.strokeDashoffset=0; }
  var ring=document.getElementById('t-ring');
  if(CUR.timed&&ring) ring.style.strokeDashoffset=(741*(1-p));
  var m=Math.floor(ds/60),s=ds%60;
  var tdisp=document.getElementById('t-disp');
  if(tdisp) tdisp.textContent=pad(m)+':'+pad(s);
  var elEl=document.getElementById('s-elapsed');
  if(elEl){
    if(!CUR.timed){ elEl.style.display='none'; }
    else{
      elEl.style.display='';
      var em=Math.floor(elapsed/60),es=elapsed%60;
      elEl.textContent='Elapsed: '+em+'m '+es+'s';
    }
  }
  updateSessionXPDisplay();
}
function pad(n){return String(n).padStart(2,'0');}

/* ---- SESSION PiP (minimize) ---- */
var SESS_MIN=false;
var PIP_WIN=null;

async function minimizeSess(){
  if(!CUR)return;
  SESS_MIN=true;
  document.getElementById('sess').classList.remove('active');
  document.getElementById('rbn').classList.remove('show');
  /* Try Document Picture-in-Picture (Chrome 116+, always on top of all tabs) */
  if(window.documentPictureInPicture){
    try{
      PIP_WIN=await window.documentPictureInPicture.requestWindow({width:260,height:200});
      var accentColor='#3d8fe0';
      var pipCSS="*{margin:0;padding:0;box-sizing:border-box;}"
        +"body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"
        +"background:#111827;color:#f1f5f9;display:flex;flex-direction:column;"
        +"align-items:center;justify-content:center;height:100vh;gap:6px;"
        +"overflow:hidden;-webkit-font-smoothing:antialiased;}"
        +"#pip-subj{font-size:11px;font-weight:800;color:"+accentColor+";letter-spacing:.3px;"
        +"white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;text-align:center;}"
        +"#pip-time{font-size:54px;font-weight:900;letter-spacing:-3px;"
        +"font-variant-numeric:tabular-nums;line-height:1;color:#f8fafc;}"
        +"#pip-label{font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.8px;}"
        +"#pip-status{font-size:11px;color:#94a3b8;font-weight:600;}"
        +"#pip-expand{background:"+accentColor+";color:#fff;border:none;border-radius:8px;"
        +"font-size:11px;font-weight:800;padding:6px 16px;cursor:pointer;margin-top:6px;"
        +"font-family:inherit;transition:filter .15s;}"
        +"#pip-expand:hover{filter:brightness(1.15);}";
      PIP_WIN.document.head.innerHTML='<meta charset="utf-8"><style>'+pipCSS+'</style>';
      PIP_WIN.document.body.innerHTML=
        '<div id="pip-subj">'+(CUR.subj||'Session')+'</div>'+
        '<div id="pip-time">00:00</div>'+
        '<div id="pip-label">remaining</div>'+
        '<div id="pip-status">\u25cf In Progress</div>'+
        '<button id="pip-expand">\u26f6 Expand</button>';
      PIP_WIN.document.getElementById('pip-expand').addEventListener('click',function(){
        maximizeSess();
      });
      PIP_WIN.addEventListener('pagehide',function(){
        /* User closed the pip window via the X button */
        if(SESS_MIN){ SESS_MIN=false; PIP_WIN=null;
          if(CUR){ document.getElementById('sess').classList.add('active'); updTDisp(); } }
      });
      updPipDisp(); return;
    }catch(e){ /* API not available or user denied, fall through to floating div */ }
  }
  /* Fallback: draggable floating div */
  document.getElementById('sess-pip').classList.add('show');
  if(CUR.subj)document.getElementById('pip-subj').textContent=CUR.subj;
  updPipDisp();
}

function maximizeSess(){
  SESS_MIN=false;
  if(PIP_WIN){ try{ PIP_WIN.close(); }catch(e){} PIP_WIN=null; }
  document.getElementById('sess-pip').classList.remove('show');
  if(CUR){ document.getElementById('sess').classList.add('active'); updTDisp(); }
}

function updPipDisp(){
  if(!CUR||!SESS_MIN)return;
  var elapsed=getSessionElapsed();
  var ds,lbl;
  if(CUR.timed){ ds=Math.max(0,CUR.total-elapsed); lbl='remaining'; }
  else{ ds=elapsed; lbl='elapsed'; }
  var m=Math.floor(ds/60),s=ds%60;
  var timeStr=pad(m)+':'+pad(s);
  var statusStr=CUR.paused?'\u23f8 Paused':'\u25cf In Progress';
  /* Update Document PiP window */
  if(PIP_WIN&&!PIP_WIN.closed){
    var pt=PIP_WIN.document.getElementById('pip-time');
    var pl=PIP_WIN.document.getElementById('pip-label');
    var ps=PIP_WIN.document.getElementById('pip-status');
    if(pt)pt.textContent=timeStr;
    if(pl)pl.textContent=lbl;
    if(ps)ps.textContent=statusStr;
    return;
  }
  /* Update fallback floating div */
  var pt2=document.getElementById('pip-time');
  var pl2=document.getElementById('pip-label');
  var ps2=document.getElementById('pip-status');
  if(pt2)pt2.textContent=timeStr;
  if(pl2)pl2.textContent=lbl;
  if(ps2)ps2.textContent=statusStr;
}

/* Draggable fallback pip */
(function(){
  function initPipDrag(){
    var pip=document.getElementById('sess-pip');
    var handle=document.getElementById('pip-drag-bar');
    if(!pip||!handle)return;
    var ox=0,oy=0,dragging=false;
    function onDown(e){
      dragging=true; pip.classList.add('pip-dragging');
      var cx=e.touches?e.touches[0].clientX:e.clientX;
      var cy=e.touches?e.touches[0].clientY:e.clientY;
      var r=pip.getBoundingClientRect(); ox=cx-r.left; oy=cy-r.top;
      e.preventDefault();
    }
    function onMove(e){
      if(!dragging)return;
      var cx=e.touches?e.touches[0].clientX:e.clientX;
      var cy=e.touches?e.touches[0].clientY:e.clientY;
      var x=cx-ox,y=cy-oy;
      var mw=window.innerWidth-pip.offsetWidth-8;
      var mh=window.innerHeight-pip.offsetHeight-8;
      x=Math.max(8,Math.min(x,mw)); y=Math.max(8,Math.min(y,mh));
      pip.style.right='auto'; pip.style.bottom='auto';
      pip.style.left=x+'px'; pip.style.top=y+'px';
    }
    function onUp(){ if(!dragging)return; dragging=false; pip.classList.remove('pip-dragging'); }
    handle.addEventListener('mousedown',onDown);
    handle.addEventListener('touchstart',onDown,{passive:false});
    document.addEventListener('mousemove',onMove);
    document.addEventListener('touchmove',onMove,{passive:false});
    document.addEventListener('mouseup',onUp);
    document.addEventListener('touchend',onUp);
  }
  document.addEventListener('DOMContentLoaded',initPipDrag);
})();
function fmtDur(mins){
  if(mins<60)return mins+'m';
  var h=Math.floor(mins/60),m=mins%60;
  return m===0?(h+'h'):(h+'h '+m+'m');
}
function endSess(done){
  if(!CUR)return;
  clearInterval(STMR);clearInterval(PNTMR);clearInterval(REMTMR);
  relWL();stopSM();
  try{ if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen(); }catch(e){}
  stopPauseCountdown();
  CUR.el=getSessionElapsed();
  var dur=CUR.el,xp=Math.floor(dur/60),subj=CUR.subj;
  var rec={id:uid(),subj:subj,subjs:CUR.subjs||[subj],subjsDetail:CUR.subjsDetail||[],dur:dur,d:today(),done:done,ts:Date.now(),xp:xp,open:!CUR.timed};
  D.sess.push(rec); D.sess.sort(function(a,b){return safeNum(a.ts,0)-safeNum(b.ts,0);});
  D.xp=calcXP();
  localStorage.setItem('fl_s',JSON.stringify(D.sess));
  localStorage.setItem('fl_xp',D.xp);
  recalcStreak(); chkAch();
  document.getElementById('sess').classList.remove('active');
  document.getElementById('rbn').classList.remove('show');
  var pip=document.getElementById('sess-pip'); if(pip)pip.classList.remove('show');
  if(PIP_WIN){ try{ PIP_WIN.close(); }catch(e){} PIP_WIN=null; }
  SESS_MIN=false;
  closeMG(); closeSessionCalc(); clearSessionState(); CUR=null;
  refreshDerivedAndUI(); scheduleCloudSave();
  notifyApp('Session complete','You earned '+xp+' XP from this session.',{tag:'session-complete',requireInteraction:true});
}
function recalcStreak(){
  var days={};
  D.sess.forEach(function(s){if(s&&s.d)days[s.d]=true;});
  var c=0; var dt=new Date();
  while(days[dt.toISOString().split('T')[0]]){ c++; dt.setDate(dt.getDate()-1); }
  D.streak={c:c,d:c?today():''};
  localStorage.setItem('fl_st',JSON.stringify(D.streak)); scheduleCloudSave();
}

// ===== VISIBILITY =====
function onVis(){
  if(!CUR||CUR.paused||!CUR.lock){ if(CUR)saveSessionState(); return; }
  if(document.hidden){ document.getElementById('rbn').classList.add('show'); notifyApp('Foc Lock','Get back to your study session!',{tag:'focus-loss',requireInteraction:true}); }
  if(CUR)saveSessionState();
}
function retSess(){ document.getElementById('rbn').classList.remove('show'); }

// ===== WAKE LOCK =====
async function acqWL(){ try{ if(CUR&&CUR.lock&&'wakeLock' in navigator) WL=await navigator.wakeLock.request('screen'); }catch(e){} }
function relWL(){ if(WL){ try{WL.release();}catch(e){} WL=null; } }

// ===== MATH GATE =====
function reqPause(){ genMQ(); document.getElementById('mgate').classList.add('open'); document.getElementById('m-ans').value=''; }
function genMQ(){
  var ops=['+','-','*'],op=ops[Math.floor(Math.random()*ops.length)];
  var a,b;
  if(op==='+'){a=ri(1,20);b=ri(1,20);MANS=a+b;}
  else if(op==='-'){a=ri(10,30);b=ri(1,a);MANS=a-b;}
  else{a=ri(2,9);b=ri(2,9);MANS=a*b;}
  document.getElementById('m-q').textContent=a+' '+(op==='*'?'×':op)+' '+b+' = ?';
}
function ri(a,b){return Math.floor(Math.random()*(b-a+1))+a;}
function chkMath(){ if(parseInt(document.getElementById('m-ans').value)===MANS){closeMG();pauseSess();} }
function closeMG(){ document.getElementById('mgate').classList.remove('open'); }
function pauseSess(){
  if(!CUR)return;
  var el=getSessionElapsed();
  CUR.elapsed=el; CUR.el=el; CUR.paused=true; CUR.savedAt=Date.now();
  startPauseCountdown();
  document.getElementById('btn-pause').style.display='none';
  document.getElementById('btn-resume').style.display='flex';
  document.getElementById('btn-end').style.display='flex';
  relWL(); syncReminderLoop(); saveSessionState(); updTDisp();
  notifyApp('Foc Lock','Session paused. Get back to studying!',{tag:'session-paused',requireInteraction:true});
}
function resumeSess(){
  if(!CUR)return;
  CUR.paused=false; CUR.savedAt=Date.now();
  stopPauseCountdown();
  document.getElementById('btn-pause').style.display='flex';
  document.getElementById('btn-resume').style.display='none';
  document.getElementById('btn-end').style.display='none';
  if(CUR.lock)acqWL(); syncReminderLoop(); saveSessionState(); updTDisp();
  notifyApp('Foc Lock','Session resumed.',{tag:'session-resumed',requireInteraction:false});
}

// ===== NOTIFICATIONS =====
var NOTIF_ICON='https://foclock.vercel.app/clogo.png';
var NOTIF_BADGE='https://foclock.vercel.app/clogo.png';
var SW_REG=null;
function initNotifServiceWorker(){
  if(!('serviceWorker' in navigator))return;
  try{
    var swCode="self.addEventListener('notificationclick',function(e){e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){for(var i=0;i<list.length;i++){if('focus' in list[i])return list[i].focus();}if(clients.openWindow)return clients.openWindow('/');}));});";
    var blob=new Blob([swCode],{type:'application/javascript'});
    var swUrl=URL.createObjectURL(blob);
    navigator.serviceWorker.register(swUrl).then(function(reg){ SW_REG=reg; }).catch(function(){});
  }catch(e){}
}
function ensureBrowserNotifications(){
  if(!('Notification' in window))return Promise.resolve(false);
  initNotifServiceWorker();
  if(Notification.permission==='granted')return Promise.resolve(true);
  if(Notification.permission==='denied')return Promise.resolve(false);
  return Notification.requestPermission().then(function(p){return p==='granted';}).catch(function(){return false;});
}
function sndNotif(t,b,o){
  if(!('Notification' in window)||Notification.permission!=='granted')return false;
  var opts={body:String(b||''),icon:NOTIF_ICON,badge:NOTIF_BADGE,tag:o&&o.tag?String(o.tag):undefined,renotify:true,silent:false,requireInteraction:!!(o&&o.requireInteraction)};
  // Prefer the service worker path: required on Android Chrome, where the
  // bare `new Notification()` constructor is blocked and fails silently.
  if(SW_REG&&SW_REG.showNotification){
    try{ SW_REG.showNotification(t,opts); return true; }catch(e){}
  }
  try{ new Notification(t,opts); return true; }
  catch(e){
    if(SW_REG&&SW_REG.showNotification){
      try{ SW_REG.showNotification(t,opts); return true; }catch(e2){}
    }
    return false;
  }
}
function notifyApp(t,b,o){ if(!sndNotif(t,b,o))toast(b||t); }
function enableBrowserNotifications(){ ensureBrowserNotifications().then(function(ok){ toast(ok?'Browser notifications enabled.':'Notifications are blocked.'); }); }
function testBrowserNotification(){ ensureBrowserNotifications().then(function(ok){ if(ok)notifyApp('Foc Lock test','This is a browser notification test.',{tag:'test-notification',requireInteraction:true}); else toast('Notifications are blocked.'); }); }

// ===== AUDIO =====
function getACtx(){ if(!ACTX)ACTX=new(window.AudioContext||window.webkitAudioContext)(); return ACTX; }
function mkNoise(type){
  var ctx=getACtx(); var len=ctx.sampleRate*3;
  var buf=ctx.createBuffer(1,len,ctx.sampleRate); var d=buf.getChannelData(0);
  for(var i=0;i<len;i++){
    if(type==='white')d[i]=(Math.random()*2-1);
    else if(type==='rain')d[i]=(Math.random()*2-1)*(0.2+0.8*Math.random());
    else if(type==='forest')d[i]=(Math.random()*2-1)*0.25+(Math.random()<.0008?Math.sin(i*.008)*.4:0);
    else if(type==='ocean'){ var t=i/ctx.sampleRate; var swell=(Math.sin(t*0.45*Math.PI)+1)/2; var wave=Math.sin(t*1.2*Math.PI)*0.18; var foam=(Math.random()*2-1)*0.48; d[i]=(foam*swell*0.55)+(wave*0.35)+(Math.sin(t*0.08*Math.PI)*0.08); }
  }
  var src=ctx.createBufferSource(); src.buffer=buf; src.loop=true;
  var baseMul={white:0.28,rain:0.55,forest:0.5,ocean:0.6}[type]||0.28;
  var gain=ctx.createGain(); var vol=parseInt(document.getElementById('amb-vol').value)/100*baseMul; gain.gain.value=vol;
  var filt=ctx.createBiquadFilter();
  if(type==='rain'){filt.type='bandpass';filt.frequency.value=1200;filt.Q.value=0.3;}
  else if(type==='forest'){filt.type='lowpass';filt.frequency.value=3200;}
  else if(type==='ocean'){filt.type='lowpass';filt.frequency.value=900;}
  else{filt.type='lowpass';filt.frequency.value=2800;}
  src.connect(filt);filt.connect(gain);gain.connect(ctx.destination);src.start();
  return{src:src,gain:gain,type:type};
}
function togAmb(type,btn){
  /* Stop lofi and bengali first — only one music at a time */
  stopLofi(); stopBengali();
  if(CURNAMB===type){
    if(ANODES[type]){try{ANODES[type].src.stop();}catch(e){} delete ANODES[type];}
    btn.classList.remove('playing'); CURNAMB=null; SAMAN=null;
  } else {
    if(CURNAMB&&ANODES[CURNAMB]){try{ANODES[CURNAMB].src.stop();}catch(e){} delete ANODES[CURNAMB];}
    document.querySelectorAll('.abtn').forEach(function(b){b.classList.remove('playing');});
    try{ANODES[type]=mkNoise(type);btn.classList.add('playing');CURNAMB=type;SAMAN=type;}
    catch(e){toast('Audio not available');}
  }
  /* Sync session music bar chip */
  document.querySelectorAll('.mchip').forEach(function(c){c.classList.toggle('active',c.textContent.toLowerCase()===type&&CURNAMB===type);});
  updateSessionMusicUI();
}
function setAmbVol(v){ if(CURNAMB&&ANODES[CURNAMB]){var m={white:0.28,rain:0.55,forest:0.5,ocean:0.6}[CURNAMB]||0.28; ANODES[CURNAMB].gain.gain.value=v/100*m;} }

var BENGALI_STATIONS=[
  {name:'Radio 1',sub:'Music',url:'https://stream.zeno.fm/nxfshdayjrdvv'},
  {name:'Radio 2',sub:'Music',url:'https://stream.zeno.fm/ie8zrtpn7i5vv'},
  {name:'Radio 3',sub:'Music',url:'https://radio.mellowbangla.com/stream'},
  {name:'Radio 4',sub:'Music',url:'https://stream.zeno.fm/8wv4d8g4344tv'},
  {name:'Radio 5',sub:'Music',url:'https://stream.zeno.fm/ie8zrtpn7i5vv'},
  {name:'Radio 6',sub:'Music',url:'https://stream.zeno.fm/xuin6ocdc2juv'},
  {name:'Radio 7',sub:'Music',url:'https://stream.zeno.fm/cwa3vg8s8druv'}
];
var CUR_BENGALI_INDEX=0;
var LOFI_STATIONS=[
  {name:'Lofi Hip Hop Radio',sub:'Chill beats to study',url:'https://streams.ilovemusic.de/iloveradio17.mp3'},
  {name:'Chillout Radio',sub:'Ambient & chill vibes',url:'https://streams.ilovemusic.de/iloveradio2.mp3'},
  {name:'Calm Instrumental',sub:'Focus music',url:'https://ice5.somafm.com/fluid-128-mp3'}
];

function renderLofi(){
  var c=document.getElementById('lofi-list'); if(!c)return;
  c.innerHTML=LOFI_STATIONS.map(function(s,i){
    return '<div class="lofi-item'+(i===CUR_LOFI_INDEX?' playing':'')+'" id="lf-'+i+'" onclick="playLofiStation('+i+',this,true)">'
      +'<div style="width:36px;height:36px;background:rgba(61,143,224,.1);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
      +'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent2)" stroke-width="1.8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>'
      +'<div class="lofi-item-info"><div class="lofi-item-name">'+s.name+'</div><div class="lofi-item-sub">'+s.sub+'</div></div>'
      +'<div style="width:28px;height:28px;background:rgba(61,143,224,.1);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
      +'<svg width="12" height="12" viewBox="0 0 24 24" fill="var(--accent2)"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>';
  }).join('');
}
function playLofiStation(index,btn,showToast){
  CUR_LOFI_INDEX=((index%LOFI_STATIONS.length)+LOFI_STATIONS.length)%LOFI_STATIONS.length;
  SAMAN='lofi';
  var s=LOFI_STATIONS[CUR_LOFI_INDEX];
  var a=document.getElementById('lofi-audio');
  document.querySelectorAll('#lofi-list .lofi-item').forEach(function(b){b.classList.remove('playing');});
  var active=document.getElementById('lf-'+CUR_LOFI_INDEX); if(active)active.classList.add('playing');
  if(CURLOFI===s.url&&a&&!a.paused){ a.pause(); updateSessionMusicUI(); if(showToast)toast('Paused '+s.name); return; }
  a.src=s.url; a.volume=document.getElementById('lofi-vol').value/100;
  a.play().then(function(){ CURLOFI=s.url; updateSessionMusicUI(); if(showToast)toast('Playing '+s.name); })
  .catch(function(){ toast('Stream unavailable. Try another.'); updateSessionMusicUI(); });
}
function toggleLofiPlayback(){
  var a=document.getElementById('lofi-audio'); if(!LOFI_STATIONS.length)return;
  if(a.src&&!a.paused){ a.pause(); updateSessionMusicUI(); return; }
  if(!CURLOFI){ playLofiStation(CUR_LOFI_INDEX||0,null,true); return; }
  a.play().then(function(){updateSessionMusicUI();}).catch(function(){playLofiStation(CUR_LOFI_INDEX||0,null,true);});
}
function nextLofi(){ playLofiStation((CUR_LOFI_INDEX+1)%LOFI_STATIONS.length,null,true); }
function prevLofi(){ playLofiStation((CUR_LOFI_INDEX-1+LOFI_STATIONS.length)%LOFI_STATIONS.length,null,true); }
function setBengVol(v){ document.getElementById('bg-audio').volume=v/100; }
function playBengaliStation(index,showToast){
  CUR_BENGALI_INDEX=index; SAMAN='bengali';
  var station=BENGALI_STATIONS[index];
  var a=document.getElementById('bg-audio');
  var st=document.getElementById('beng-status');
  var nm=document.getElementById('beng-current-name');
  renderBengaliStations();
  if(nm)nm.textContent=station.name;
  if(st)st.textContent='Connecting...';
  a.src=station.url; a.volume=document.getElementById('beng-vol').value/100;
  a.play().then(function(){ if(st)st.textContent='Now playing • '+station.sub; if(showToast)toast('Playing '+station.name); updateSessionMusicUI(); })
  .catch(function(){ if(st)st.textContent='Stream unavailable. Try next station.'; updateSessionMusicUI(); toast('Could not play this station'); });
}
function nextBengali(){ CUR_BENGALI_INDEX=(CUR_BENGALI_INDEX+1)%BENGALI_STATIONS.length; playBengaliStation(CUR_BENGALI_INDEX,true); }
function prevBengali(){ CUR_BENGALI_INDEX=(CUR_BENGALI_INDEX-1+BENGALI_STATIONS.length)%BENGALI_STATIONS.length; playBengaliStation(CUR_BENGALI_INDEX,true); }
function togBeng(){
  /* Stop ambient and lofi first */
  stopNoise(); CURNAMB=null;
  document.querySelectorAll('.abtn').forEach(function(b){b.classList.remove('playing');});
  stopLofi();
  SAMAN='bengali';
  var a=document.getElementById('bg-audio'); var st=document.getElementById('beng-status');
  if(!a.src||a.paused){ playBengaliStation(CUR_BENGALI_INDEX,true); }
  else{ a.pause(); if(st)st.textContent='Paused'; updateSessionMusicUI(); }
}
function renderBengaliStations(){
  var c=document.getElementById('beng-station-list'); if(!c)return;
  c.innerHTML=BENGALI_STATIONS.map(function(s,i){
    return '<div class="beng-item'+(i===CUR_BENGALI_INDEX?' playing':'')+'" onclick="playBengaliStation('+i+',true)">'
      +'<div style="width:36px;height:36px;background:rgba(61,143,224,.08);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
      +'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent3)" stroke-width="1.8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>'
      +'<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;">'+s.name+'</div><div style="font-size:11px;color:var(--text2);margin-top:2px;font-weight:500;">'+s.sub+'</div></div>'
      +'<div style="width:28px;height:28px;background:rgba(61,143,224,.08);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
      +'<svg width="12" height="12" viewBox="0 0 24 24" fill="var(--accent3)"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>';
  }).join('');
}

// ===== SESSION MUSIC =====
var SAMAN=null,SANODE=null;
function getAmbientLabel(type){ return{rain:'Rain',white:'White Noise',forest:'Forest',ocean:'Ocean'}[type]||'Ambient'; }
function updateSessionMusicUI(){
  var state=document.getElementById('smusic-state');
  var prev=document.getElementById('sm-prev');
  var play=document.getElementById('sm-play');
  var next=document.getElementById('sm-next');
  var lofiAudio=document.getElementById('lofi-audio');
  var bengAudio=document.getElementById('bg-audio');
  var label='No music selected'; var playing=false;
  if(['rain','white','forest','ocean'].includes(SAMAN)){
    label='Ambient • '+getAmbientLabel(SAMAN)+(CURNAMB===SAMAN&&ANODES[SAMAN]?' • Playing':' • Paused');
    playing=(CURNAMB===SAMAN&&!!ANODES[SAMAN]);
  }else if(SAMAN==='lofi'){
    var st=LOFI_STATIONS[CUR_LOFI_INDEX]||LOFI_STATIONS[0];
    label='Lo-Fi • '+(st?st.name:'Station')+(lofiAudio&&!lofiAudio.paused&&CURLOFI?' • Playing':' • Paused');
    playing=!!(lofiAudio&&!lofiAudio.paused&&CURLOFI);
  }else if(SAMAN==='bengali'){
    var bs=BENGALI_STATIONS[CUR_BENGALI_INDEX]||BENGALI_STATIONS[0];
    label='Songs • '+(bs?bs.name:'Radio')+(bengAudio&&!bengAudio.paused&&bengAudio.src?' • Playing':' • Paused');
    playing=!!(bengAudio&&!bengAudio.paused&&bengAudio.src);
  }
  if(state)state.textContent=label;
  if(play){
    play.innerHTML=playing
      ?'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>'
      :'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
    play.title=playing?'Pause':'Play';
  }
  if(prev)prev.disabled=!(SAMAN&&SAMAN!=='none');
  if(next)next.disabled=!(SAMAN&&SAMAN!=='none');
  /* Sync Studio Music mchip highlights */
  document.querySelectorAll('.mchip').forEach(function(c){
    var t=c.textContent.toLowerCase().trim();
    var match=(t===SAMAN)||(t==='rain'&&SAMAN==='rain')||(t==='white noise'&&SAMAN==='white')||(t==='forest'&&SAMAN==='forest')||(t==='ocean'&&SAMAN==='ocean')||(t==='lo-fi'&&SAMAN==='lofi')||(t==='songs'&&SAMAN==='bengali');
    c.classList.toggle('active',!!match);
  });
  /* Sync Studio beng play button icon */
  var bengAudio2=document.getElementById('bg-audio');
  var bengBtn=document.getElementById('beng-main-play');
  if(bengBtn){
    var isPlaying=bengAudio2&&!bengAudio2.paused&&bengAudio2.src;
    bengBtn.innerHTML=isPlaying
      ?'<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
      :'<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  }
  /* Sync beng-status text */
  if(SAMAN==='bengali'){
    var bs2=BENGALI_STATIONS[CUR_BENGALI_INDEX]||BENGALI_STATIONS[0];
    var bst=document.getElementById('beng-status');
    var ba2=document.getElementById('bg-audio');
    if(bst)bst.textContent=ba2&&!ba2.paused?'Playing '+bs2.name:'Paused';
  }
}
function stopNoise(){ if(CURNAMB&&ANODES[CURNAMB]){try{ANODES[CURNAMB].src.stop();}catch(e){} delete ANODES[CURNAMB];} SANODE=null; }
function stopLofi(){ var a=document.getElementById('lofi-audio'); a.pause(); a.src=''; CURLOFI=null; document.querySelectorAll('#lofi-list .lofi-item').forEach(function(b){b.classList.remove('playing');}); updateSessionMusicUI(); }
function stopBengali(){
  var a=document.getElementById('bg-audio'); a.pause(); a.removeAttribute('src'); a.load();
  var st=document.getElementById('beng-status'); if(st)st.textContent='Ready to play';
  updateSessionMusicUI();
}
function setSM(type,chip){
  document.querySelectorAll('.mchip').forEach(function(c){c.classList.remove('active');});
  stopNoise(); stopLofi(); stopBengali();
  /* Also clear Studio ambient buttons */
  document.querySelectorAll('.abtn').forEach(function(b){b.classList.remove('playing');});
  CURNAMB=null;
  if(type==='none'){ SAMAN=null; updateSessionMusicUI(); return; }
  if(chip)chip.classList.add('active');
  SAMAN=type;
  if(['rain','white','forest','ocean'].includes(type)){
    try{ANODES[type]=mkNoise(type);CURNAMB=type;}catch(e){}
    /* Highlight the matching Studio ambient button */
    var abtn=document.getElementById('a-'+type);
    if(abtn)abtn.classList.add('playing');
  }
  else if(type==='lofi'){ playLofiStation(CUR_LOFI_INDEX||0,null,false); }
  else if(type==='bengali'){ playBengaliStation(CUR_BENGALI_INDEX,false); }
  updateSessionMusicUI();
}
function stopSM(){ stopNoise(); stopLofi(); stopBengali(); SAMAN=null; updateSessionMusicUI(); }
function sessionMediaPlayPause(){
  if(!SAMAN||SAMAN==='none'){ toast('Choose a music type first.'); return; }
  if(['rain','white','forest','ocean'].includes(SAMAN)){
    if(CURNAMB===SAMAN&&ANODES[SAMAN]){ stopNoise(); CURNAMB=null; updateSessionMusicUI(); return; }
    try{ANODES[SAMAN]=mkNoise(SAMAN);CURNAMB=SAMAN;}catch(e){toast('Audio not available');} updateSessionMusicUI(); return;
  }
  if(SAMAN==='lofi'){ toggleLofiPlayback(); return; }
  if(SAMAN==='bengali'){ togBeng(); updateSessionMusicUI(); return; }
}
function sessionMediaNext(){
  if(!SAMAN||SAMAN==='none')return;
  if(['rain','white','forest','ocean'].includes(SAMAN)){ var am=['rain','white','forest','ocean']; var i=am.indexOf(SAMAN); setSM(am[(i+1)%am.length],null); return; }
  if(SAMAN==='lofi'){nextLofi();return;}
  if(SAMAN==='bengali'){nextBengali();updateSessionMusicUI();return;}
}
function sessionMediaPrev(){
  if(!SAMAN||SAMAN==='none')return;
  if(['rain','white','forest','ocean'].includes(SAMAN)){ var am=['rain','white','forest','ocean']; var i=am.indexOf(SAMAN); setSM(am[(i-1+am.length)%am.length],null); return; }
  if(SAMAN==='lofi'){prevLofi();return;}
  if(SAMAN==='bengali'){prevBengali();updateSessionMusicUI();return;}
}
function setSTab(tab,el){
  document.querySelectorAll('.stab').forEach(function(t){t.classList.remove('active');});
  document.querySelectorAll('.spanel').forEach(function(p){p.classList.remove('active');});
  el.classList.add('active'); document.getElementById('sp-'+tab).classList.add('active');
}

// ===== CHART =====
function initChart(){
  var ctx=document.getElementById('prog-chart').getContext('2d');
  PCHART=new Chart(ctx,{
    type:'bar',
    data:getChartData(),
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){return fmtDur(ctx.parsed.y);}}}},
      scales:{
        y:{ticks:{color:function(){return getComputedStyle(document.getElementById('app')).getPropertyValue('--text2').trim()||'#8a96a8';},callback:function(v){return fmtDur(v);},font:{family:'Plus Jakarta Sans',weight:'600'}},grid:{color:D.theme==='light'?'rgba(0,0,0,.06)':'rgba(255,255,255,.05)'},border:{display:false}},
        x:{ticks:{color:function(){return getComputedStyle(document.getElementById('app')).getPropertyValue('--text2').trim()||'#8a96a8';},font:{family:'Plus Jakarta Sans',weight:'700'}},grid:{display:false},border:{display:false}}
      }
    }
  });
}
function getChartData(){
  var labels=[],data=[]; var days=PERIOD==='week'?7:30;
  for(var i=days-1;i>=0;i--){
    var d=new Date(); d.setDate(d.getDate()-i);
    var str=d.toISOString().split('T')[0];
    labels.push(PERIOD==='week'?d.toLocaleDateString('en-US',{weekday:'short'}):d.getDate());
    var m=Math.round(D.sess.filter(function(s){return s.d===str;}).reduce(function(a,s){return a+s.dur;},0)/60);
    data.push(m);
  }
  return{labels:labels,datasets:[{data:data,backgroundColor:PERIOD==='week'?'rgba(61,143,224,.6)':'rgba(61,143,224,.55)',hoverBackgroundColor:PERIOD==='week'?'rgba(155,125,255,.85)':'rgba(61,143,224,.85)',borderRadius:6,borderSkipped:false}]};
}
/* ── DAILY ACTIVITY CHART ── */
var DCHART=null;
var DAY_VIEW='today';
var DAY_DATE=today();

function setDayViewDrop(val){
  var di=document.getElementById('day-date-inp');
  if(val==='pick'){
    if(di){ di.style.display='block'; di.value=DAY_DATE; di.focus(); }
    return;
  }
  if(di) di.style.display='none';
  setDayView(val,null,null);
}
function setDayView(mode,el,dateVal){
  DAY_VIEW=mode;
  if(mode==='custom'&&dateVal){
    DAY_DATE=dateVal;
    /* Update dropdown to show nothing selected if custom */
    var drop=document.getElementById('day-drop');
    if(drop) drop.value='pick';
  } else if(mode==='today'){
    DAY_DATE=today();
    var drop=document.getElementById('day-drop');
    if(drop) drop.value='today';
  } else if(mode==='yesterday'){
    DAY_DATE=yesterday();
    var drop=document.getElementById('day-drop');
    if(drop) drop.value='yesterday';
  }
  updDayChart();
}

function getDayBuckets(dateStr){
  var buckets=new Array(24).fill(0);
  var daySess=(D.sess||[]).filter(function(s){return s.d===dateStr&&s.ts&&s.dur;});
  daySess.forEach(function(s){
    var startMs=s.ts, endMs=startMs+(s.dur*1000), cur=startMs;
    while(cur<endMs){
      var dt=new Date(cur); var h=dt.getHours();
      var nxt=new Date(dt.getFullYear(),dt.getMonth(),dt.getDate(),h+1,0,0,0).getTime();
      var until=Math.min(endMs,nxt);
      buckets[h]+=(until-cur)/60000;
      cur=until;
    }
  });
  return buckets;
}

function hrLabel(h){
  if(h===0)return'12am'; if(h<12)return h+'am';
  if(h===12)return'12pm'; return(h-12)+'pm';
}

function updDayChart(){
  var canvasEl=document.getElementById('day-chart');
  if(!canvasEl)return;
  var dateStr=DAY_DATE;
  var buckets=getDayBuckets(dateStr);
  var labels=[]; for(var h=0;h<24;h++) labels.push(hrLabel(h));

  /* Header label */
  var d=new Date(dateStr+'T12:00:00'); var lbl;
  if(dateStr===today()) lbl='Today \u2014 '+d.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
  else if(dateStr===yesterday()) lbl='Yesterday \u2014 '+d.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
  else lbl=d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  var lblEl=document.getElementById('day-chart-lbl'); if(lblEl) lblEl.textContent=lbl;

  /* Stats */
  var totalMin=buckets.reduce(function(a,b){return a+b;},0);
  var sessions=(D.sess||[]).filter(function(s){return s.d===dateStr;});
  var statsEl=document.getElementById('day-stats');
  if(statsEl){
    if(totalMin<0.5){
      statsEl.innerHTML='<div class="day-no-data" style="grid-column:1/-1;">No study activity recorded for this day.</div>';
    } else {
      var peakH=buckets.indexOf(Math.max.apply(null,buckets));
      var avgMin=sessions.length?Math.round(totalMin/sessions.length):0;
      statsEl.innerHTML=
        '<div class="day-stat"><div class="ds-val">'+fmtDur(Math.round(totalMin))+'</div><div class="ds-lbl">Total</div></div>'+
        '<div class="day-stat"><div class="ds-val">'+sessions.length+'</div><div class="ds-lbl">Sessions</div></div>'+
        '<div class="day-stat"><div class="ds-val">'+hrLabel(peakH)+'</div><div class="ds-lbl">Peak Hour</div></div>'+
        '<div class="day-stat"><div class="ds-val">'+fmtDur(avgMin)+'</div><div class="ds-lbl">Avg/Sess</div></div>';
    }
  }

  /* Build chart */
  if(DCHART){ DCHART.destroy(); DCHART=null; }
  var ctx=canvasEl.getContext('2d');
  var chartH=canvasEl.parentElement?canvasEl.parentElement.clientHeight||160:160;

  /* Gradient fill — blue to transparent */
  var grad=ctx.createLinearGradient(0,0,0,chartH);
  grad.addColorStop(0,'rgba(59,130,246,.5)');
  grad.addColorStop(0.65,'rgba(59,130,246,.12)');
  grad.addColorStop(1,'rgba(59,130,246,0)');

  var mx=Math.max.apply(null,buckets);
  DCHART=new Chart(ctx,{
    type:'line',
    data:{
      labels:labels,
      datasets:[{
        data:buckets,
        borderColor:'#3b82f6',
        borderWidth:2.5,
        backgroundColor:grad,
        fill:true,
        tension:0.42,
        pointRadius:0,
        pointHoverRadius:5,
        pointHoverBackgroundColor:'#3b82f6',
        pointHoverBorderColor:'#fff',
        pointHoverBorderWidth:2
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      animation:{duration:500,easing:'easeInOutQuart'},
      plugins:{
        legend:{display:false},
        tooltip:{
          callbacks:{
            title:function(c){return c[0].label;},
            label:function(c){
              var v=c.parsed.y;
              return v>=0.5?Math.round(v)+'m studied':'No activity';
            }
          },
          backgroundColor:'rgba(10,15,30,.92)',
          titleColor:'#e5e7eb',
          bodyColor:'#9398a3',
          borderColor:'rgba(255,255,255,.08)',
          borderWidth:1,
          cornerRadius:8,
          padding:9
        }
      },
      scales:{
        y:{display:false,grid:{display:false},min:0,suggestedMax:mx>0?mx*1.25:10},
        x:{
          ticks:{
            color:'#5b6070',
            font:{family:'Plus Jakarta Sans',weight:'700',size:9},
            maxRotation:0,autoSkip:true,maxTicksLimit:7,
            callback:function(val,idx){return idx%4===0?this.getLabelForValue(val):'';}
          },
          grid:{color:'rgba(255,255,255,.05)',drawTicks:false},
          border:{display:false}
        }
      }
    }
  });
}

function updChart(){ if(!PCHART)return; PCHART.data=getChartData(); PCHART.update(); }
function setPeriod(p,el){ PERIOD=p; document.querySelectorAll('.ptab').forEach(function(t){t.classList.remove('active');}); el.classList.add('active'); updChart(); }
function yesterday(){ var d=new Date(); d.setDate(d.getDate()-1); return d.toISOString().split('T')[0]; }
function setSubjPeriod(p){
  SUBJ_PERIOD=p;
  var cr=document.getElementById('subj-custom-range');
  if(cr) cr.classList.toggle('show', p==='custom');
  if(p!=='custom') updSBars();
}
function applyCustomSubjRange(){
  var f=document.getElementById('subj-from').value;
  var t=document.getElementById('subj-to').value;
  if(!f||!t){ toast('Pick both dates.'); return; }
  if(f>t){ toast('Start date must be before end date.'); return; }
  SUBJ_FROM=f; SUBJ_TO=t;
  updSBars();
}
function getSubjPeriodLabel(){
  if(SUBJ_PERIOD==='all') return '';
  if(SUBJ_PERIOD==='today') return 'Today — '+today();
  if(SUBJ_PERIOD==='yesterday') return 'Yesterday — '+yesterday();
  if(SUBJ_PERIOD==='custom'&&SUBJ_FROM&&SUBJ_TO) return SUBJ_FROM+' → '+SUBJ_TO;
  return '';
}
function updSBars(){
  var c=document.getElementById('subj-bars');
  var lbl=document.getElementById('subj-period-label');
  // Filter sessions by period
  var filtered=D.sess;
  if(SUBJ_PERIOD==='today'){ var t=today(); filtered=D.sess.filter(function(s){return s.d===t;}); }
  else if(SUBJ_PERIOD==='yesterday'){ var y=yesterday(); filtered=D.sess.filter(function(s){return s.d===y;}); }
  else if(SUBJ_PERIOD==='custom'&&SUBJ_FROM&&SUBJ_TO){ filtered=D.sess.filter(function(s){return s.d>=SUBJ_FROM&&s.d<=SUBJ_TO;}); }
  // Show label
  var labelTxt=getSubjPeriodLabel();
  if(lbl) lbl.innerHTML=labelTxt?'<div class="subj-period-label">'+labelTxt+'</div>':'';
  // Aggregate — credit each subject in s.subjs (multi-subject support)
  var tot={}; filtered.forEach(function(s){
    var subjList=s.subjs&&s.subjs.length?s.subjs:[s.subj||'General'];
    subjList.forEach(function(k){ tot[k]=(tot[k]||0)+s.dur; });
  });
  var keys=Object.keys(tot).sort(function(a,b){return tot[b]-tot[a];});
  if(!keys.length){c.innerHTML='<div style="font-size:13px;color:var(--text2);font-weight:500;">No sessions for this period.</div>';return;}
  var mx=Math.max.apply(null,Object.values(tot));
  c.innerHTML=keys.map(function(k){
    var m=Math.round(tot[k]/60),p=Math.round(tot[k]/mx*100);
    return '<div class="sbrow"><div class="sbname">'+k+'</div><div class="sbbar"><div class="sbfill" style="width:'+p+'%"></div></div><div class="sbtime">'+fmtDur(m)+'</div></div>';
  }).join('');
}
var HIST_SHOW=10;
function updHist(){
  var c=document.getElementById('sess-hist');
  var allRev=[].concat(D.sess).reverse();
  if(!allRev.length){c.innerHTML='<div style="font-size:13px;color:var(--text2);font-weight:500;">No sessions yet.</div>';return;}
  var rc=allRev.slice(0,HIST_SHOW);
  var html=rc.map(function(s){
    var m=Math.round(s.dur/60);
    var tm=new Date(s.ts).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
    var subjDisp=(s.subjs&&s.subjs.length>1?s.subjs.join(' + '):s.subj||'General')+(s.subsubj?' <span style="font-size:10px;color:var(--text3);font-weight:600;opacity:.8;">\u203a '+s.subsubj+'</span>':'');
    return '<div class="hist-item">'
      +'<div style="flex:1;min-width:0;"><div class="hist-subj">'+subjDisp+(s.manual?' <span style="font-size:10px;color:var(--text3);font-weight:600;">[manual]</span>':'')+'</div><div class="hist-meta">'+s.d+' at '+tm+'</div></div>'
      +'<div style="text-align:right;flex-shrink:0;"><div class="hist-dur">'+fmtDur(m)+'</div>'
      +'<div class="hist-status" style="color:'+(s.manual?'var(--accent3)':s.open?(s.done?'var(--accent2)':'var(--warn)'):(s.done?'var(--success)':'var(--warn)'))+';\">'
      +(s.manual?'Manually Logged':s.open?(s.done?'Open Session':'Ended Early'):(s.done?'Completed':'Ended Early'))
      +'</div></div>'
      +'<div class="hist-actions">'
      +'<button class="hist-act-btn edit" title="Edit session" onclick="openEditSession(\''+s.id+'\')">'
      +'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
      +'</button>'
      +'<button class="hist-act-btn del" title="Delete session" onclick="deleteSession(\''+s.id+'\')">'
      +'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>'
      +'</button>'
      +'</div>'
      +'</div>';
  }).join('');
  if(allRev.length>HIST_SHOW){
    html+='<button class="show-more-btn" onclick="showMoreHist()">Show more ('+allRev.length+' total, showing '+HIST_SHOW+')</button>';
  } else if(HIST_SHOW>10){
    html+='<button class="show-more-btn" onclick="showLessHist()">Show less</button>';
  }
  c.innerHTML=html;
}
function showMoreHist(){ HIST_SHOW+=20; updHist(); }
function showLessHist(){ HIST_SHOW=10; updHist(); }
function deleteSession(id){
  var idx=D.sess.findIndex(function(s){return s.id===id;});
  if(idx===-1)return;
  var s=D.sess[idx];
  if(!confirm('Delete this session?\n'+s.subj+' \u2022 '+fmtDur(Math.round(s.dur/60))+' on '+s.d))return;
  D.sess.splice(idx,1);
  D.xp=calcXP();
  localStorage.setItem('fl_s',JSON.stringify(D.sess)); localStorage.setItem('fl_xp',D.xp);
  recalcStreak(); chkAch(); refreshDerivedAndUI(); scheduleCloudSave();
  toast('Session deleted.');
}
function openEditSession(id){
  var s=D.sess.find(function(x){return x.id===id;});
  if(!s)return;
  document.getElementById('edit-sess-id').value=s.id;
  document.getElementById('edit-subj').value=s.subj||'';
  document.getElementById('edit-date').value=s.d||'';
  var dt=new Date(s.ts);
  var hh=String(dt.getHours()).padStart(2,'0');
  var mm=String(dt.getMinutes()).padStart(2,'0');
  document.getElementById('edit-time').value=hh+':'+mm;
  document.getElementById('edit-dur').value=Math.round(s.dur/60);
  document.getElementById('edit-session-modal').classList.add('open');
}
function saveEditSession(){
  var id=document.getElementById('edit-sess-id').value;
  var idx=D.sess.findIndex(function(s){return s.id===id;});
  if(idx===-1){toast('Session not found.');return;}
  var subj=document.getElementById('edit-subj').value.trim()||'General';
  var date=document.getElementById('edit-date').value;
  var time=document.getElementById('edit-time').value||'00:00';
  var mins=parseInt(document.getElementById('edit-dur').value,10);
  if(!date){toast('Choose a date.');return;}
  if(!mins||mins<1){toast('Enter a valid duration.');return;}
  var ts=new Date(date+'T'+time+':00').getTime();
  if(isNaN(ts))ts=D.sess[idx].ts||Date.now();
  D.sess[idx].subj=subj; D.sess[idx].d=date; D.sess[idx].ts=ts;
  D.sess[idx].dur=mins*60; D.sess[idx].xp=mins;
  D.sess.sort(function(a,b){return safeNum(a.ts,0)-safeNum(b.ts,0);});
  D.xp=calcXP();
  localStorage.setItem('fl_s',JSON.stringify(D.sess)); localStorage.setItem('fl_xp',D.xp);
  recalcStreak(); chkAch(); refreshDerivedAndUI(); scheduleCloudSave();
  document.getElementById('edit-session-modal').classList.remove('open');
  toast('Session updated!');
}
function closeEditModal(){ document.getElementById('edit-session-modal').classList.remove('open'); }

// ===== REWARDS =====
var LVLS=[{n:'Beginner',x:0},{n:'Learner',x:100},{n:'Student',x:300},{n:'Scholar',x:600},{n:'Achiever',x:1000},{n:'Expert',x:1500},{n:'Master',x:2500},{n:'Legend',x:5000}];
function getLv(){ var l=0; for(var i=0;i<LVLS.length;i++){if(D.xp>=LVLS[i].x)l=i;} return l; }
function updXP(){
  var lv=getLv(); var cur=LVLS[lv],nxt=LVLS[lv+1];
  document.getElementById('lv-txt').textContent='Level '+(lv+1);
  document.getElementById('lv-name').textContent=cur.n;
  document.getElementById('xp-disp').textContent=D.xp+' XP';
  if(nxt){ var p=Math.min(100,Math.round((D.xp-cur.x)/(nxt.x-cur.x)*100)); document.getElementById('xp-bar').style.width=p+'%'; document.getElementById('xp-next').textContent='Next: '+nxt.x+' XP'; }
  else{ document.getElementById('xp-bar').style.width='100%'; document.getElementById('xp-next').textContent='Max Level!'; }
}
var GOALS=[
  {id:'g1',n:'Daily Target',d:'Reach today\'s study goal',goal:function(){return D.goal;},value:function(){return Math.round(D.sess.filter(function(s){return s.d===today();}).reduce(function(a,s){return a+s.dur;},0)/60);},unit:'min'},
  {id:'g2',n:'Session Builder',d:'Complete 3 sessions in a day',goal:function(){return 3;},value:function(){return D.sess.filter(function(s){return s.d===today();}).length;},unit:'sess'},
  {id:'g3',n:'XP Sprint',d:'Earn 250 total XP',goal:function(){return 250;},value:function(){return D.xp;},unit:'XP'},
  {id:'g4',n:'Streak Guard',d:'Hold a 7-day streak',goal:function(){return 7;},value:function(){return D.streak.c;},unit:'days'},
  {id:'g5',n:'Manual Logger',d:'Log 1 manual session',goal:function(){return 1;},value:function(){return D.sess.filter(function(s){return!!s.manual;}).length;},unit:'log'},
  {id:'g6',n:'Subject Explorer',d:'Study 5 different subjects',goal:function(){return 5;},value:function(){return uniqueStrings(D.sess.map(function(s){return s.subj;})).length;},unit:'subj'}
];
function renderGoals(){
  var el=document.getElementById('goals-grid'); if(!el)return;
  el.innerHTML=GOALS.map(function(g){
    var cur=safeNum(g.value(),0); var goal=Math.max(1,safeNum(g.goal(),1));
    var pct=Math.min(100,Math.round(cur/goal*100)); var done=cur>=goal;
    return '<div class="goal-card'+(done?' done':'')+'"><div class="goal-title">'+g.n+'</div><div class="goal-sub">'+g.d+'</div>'
      +'<div class="goal-pill'+(done?' done':'')+'">'+cur+' / '+goal+' '+g.unit+'</div>'
      +'<div class="goal-meta"><span>'+pct+'%</span></div>'
      +'<div class="goal-bar"><div class="goal-fill" style="width:'+pct+'%"></div></div></div>';
  }).join('');
}
var BDGS=[
  {id:'f1',n:'First Step',d:'Complete your 1st session',icon:'play',chk:function(){return D.sess.length>=1;}},
  {id:'m30',n:'30 Min Day',d:'Study 30 min in a day',icon:'clock',chk:function(){return D.sess.filter(function(s){return s.d===today();}).reduce(function(a,s){return a+s.dur;},0)>=1800;}},
  {id:'m60',n:'1 Hour Hero',d:'Study 1 hour in a day',icon:'zap',chk:function(){return D.sess.filter(function(s){return s.d===today();}).reduce(function(a,s){return a+s.dur;},0)>=3600;}},
  {id:'m180',n:'3 Hour Beast',d:'Study 3 hours in a day',icon:'flame',chk:function(){return D.sess.filter(function(s){return s.d===today();}).reduce(function(a,s){return a+s.dur;},0)>=10800;}},
  {id:'s3',n:'3-Day Streak',d:'Study 3 days in a row',icon:'calendar',chk:function(){return D.streak.c>=3;}},
  {id:'s7',n:'Week Warrior',d:'Study 7 days in a row',icon:'star',chk:function(){return D.streak.c>=7;}},
  {id:'s30',n:'Iron Discipline',d:'Study 30 days in a row',icon:'shield',chk:function(){return D.streak.c>=30;}},
  {id:'ss5',n:'Session Pro',d:'Complete 5 sessions',icon:'check',chk:function(){return D.sess.length>=5;}},
  {id:'ss20',n:'Dedicated',d:'Complete 20 sessions',icon:'award',chk:function(){return D.sess.length>=20;}},
  {id:'ss50',n:'Half Century',d:'Complete 50 sessions',icon:'target',chk:function(){return D.sess.length>=50;}},
  {id:'ss100',n:'Centurion',d:'Complete 100 sessions',icon:'crown',chk:function(){return D.sess.length>=100;}},
  {id:'x1',n:'XP Hunter',d:'Earn 100 XP',icon:'bolt',chk:function(){return D.xp>=100;}},
  {id:'x5',n:'XP Master',d:'Earn 500 XP',icon:'bolt',chk:function(){return D.xp>=500;}},
  {id:'x10',n:'XP Legend',d:'Earn 2,500 XP',icon:'bolt',chk:function(){return D.xp>=2500;}},
  {id:'subj5',n:'Explorer',d:'Study 5 different subjects',icon:'book',chk:function(){return uniqueStrings(D.sess.map(function(s){return s.subj;})).length>=5;}},
  {id:'subj10',n:'Polymath',d:'Study 10 different subjects',icon:'book',chk:function(){return uniqueStrings(D.sess.map(function(s){return s.subj;})).length>=10;}},

  /* ── Harder / long-haul achievements ── */
  {id:'s60',n:'60-Day Streak',d:'Study 60 days in a row',icon:'shield',chk:function(){return D.streak.c>=60;}},
  {id:'s100',n:'Unbreakable',d:'Study 100 days in a row',icon:'shield',chk:function(){return D.streak.c>=100;}},
  {id:'s365',n:'Year of Focus',d:'Study 365 days in a row',icon:'trophy',chk:function(){return D.streak.c>=365;}},
  {id:'ss250',n:'Session Veteran',d:'Complete 250 sessions',icon:'medal',chk:function(){return D.sess.length>=250;}},
  {id:'ss500',n:'Session Master',d:'Complete 500 sessions',icon:'medal',chk:function(){return D.sess.length>=500;}},
  {id:'ss1000',n:'Grandmaster',d:'Complete 1,000 sessions',icon:'crown',chk:function(){return D.sess.length>=1000;}},
  {id:'h10',n:'First 10 Hours',d:'Accumulate 10 hours studied',icon:'clock',chk:function(){return D.sess.reduce(function(a,s){return a+safeNum(s.dur,0);},0)>=36000;}},
  {id:'h50',n:'50 Hour Club',d:'Accumulate 50 hours studied',icon:'fire',chk:function(){return D.sess.reduce(function(a,s){return a+safeNum(s.dur,0);},0)>=180000;}},
  {id:'h100',n:'Century of Hours',d:'Accumulate 100 hours studied',icon:'fire',chk:function(){return D.sess.reduce(function(a,s){return a+safeNum(s.dur,0);},0)>=360000;}},
  {id:'h250',n:'250 Hour Club',d:'Accumulate 250 hours studied',icon:'rocket',chk:function(){return D.sess.reduce(function(a,s){return a+safeNum(s.dur,0);},0)>=900000;}},
  {id:'h500',n:'500 Hour Legend',d:'Accumulate 500 hours studied',icon:'trophy',chk:function(){return D.sess.reduce(function(a,s){return a+safeNum(s.dur,0);},0)>=1800000;}},
  {id:'x25',n:'XP Titan',d:'Earn 10,000 XP',icon:'bolt',chk:function(){return D.xp>=10000;}},
  {id:'x50',n:'XP Overlord',d:'Earn 25,000 XP',icon:'bolt',chk:function(){return D.xp>=25000;}},
  {id:'x100',n:'XP Ascendant',d:'Earn 50,000 XP',icon:'spark',chk:function(){return D.xp>=50000;}},
  {id:'long2',n:'Deep Work',d:'Complete a single 2-hour session',icon:'brain',chk:function(){return D.sess.some(function(s){return safeNum(s.dur,0)>=7200;});}},
  {id:'long4',n:'Marathoner',d:'Complete a single 4-hour session',icon:'rocket',chk:function(){return D.sess.some(function(s){return safeNum(s.dur,0)>=14400;});}},
  {id:'long6',n:'Iron Will',d:'Complete a single 6-hour session',icon:'shield',chk:function(){return D.sess.some(function(s){return safeNum(s.dur,0)>=21600;});}},
  {id:'early',n:'Early Bird',d:'Start a session before 6 AM',icon:'star',chk:function(){return D.sess.some(function(s){return s.ts&&new Date(s.ts).getHours()<6;});}},
  {id:'owl',n:'Night Owl',d:'Start a session after midnight',icon:'moon',chk:function(){return D.sess.some(function(s){if(!s.ts)return false;var h=new Date(s.ts).getHours();return h>=0&&h<4;});}},
  {id:'subj15',n:'Renaissance Mind',d:'Study 15 different subjects',icon:'book',chk:function(){return uniqueStrings(D.sess.map(function(s){return s.subj;})).length>=15;}},
  {id:'subj20',n:'Universal Scholar',d:'Study 20 different subjects',icon:'brain',chk:function(){return uniqueStrings(D.sess.map(function(s){return s.subj;})).length>=20;}},
  {id:'notes50',n:'Note Taker',d:'Write 50 notes',icon:'award',chk:function(){return (typeof NOTES!=='undefined'&&Array.isArray(NOTES)?NOTES.length:0)>=50;}},
  {id:'notes100',n:'Archivist',d:'Write 100 notes',icon:'trophy',chk:function(){return (typeof NOTES!=='undefined'&&Array.isArray(NOTES)?NOTES.length:0)>=100;}},
  {id:'lvl10',n:'Level 10',d:'Reach level 10',icon:'crown',chk:function(){return safeNum(D.level,1)>=10;}},
  {id:'lvl25',n:'Level 25',d:'Reach level 25',icon:'crown',chk:function(){return safeNum(D.level,1)>=25;}}
];
function chkAch(){
  BDGS.forEach(function(b){
    if(!D.ach[b.id]&&b.chk()){ D.ach[b.id]=true; localStorage.setItem('fl_a',JSON.stringify(D.ach)); scheduleCloudSave(); notifyApp('Achievement unlocked',b.n+' unlocked!',{tag:'ach-'+b.id,requireInteraction:true}); }
  });
}
function renderBadges(){
  var ICONS={
    play:'<polygon points="5 3 19 12 5 21 5 3"/>',
    clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    zap:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    flame:'<path d="M12 2c0 5-4 7-4 12a4 4 0 0 0 8 0c0-5-4-7-4-12z"/><path d="M12 10c0 3-2 4-2 7a2 2 0 0 0 4 0c0-3-2-4-2-7z"/>',
    calendar:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    star:'<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    check:'<polyline points="20 6 9 17 4 12"/>',
    award:'<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>',
    target:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    crown:'<path d="M2 20h20M5 20V10l7-7 7 7v10"/>',
    bolt:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    book:'<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    brain:'<path d="M9 3a4 4 0 0 0-4 4v1a3 3 0 0 0 0 6v1a4 4 0 0 0 4 4"/><path d="M15 3a4 4 0 0 1 4 4v1a3 3 0 0 1 0 6v1a4 4 0 0 1-4 4"/>',
    trophy:'<path d="M8 21h8M12 17v4"/><path d="M7 4h10v3a5 5 0 0 1-10 0z"/><path d="M5 6H3a3 3 0 0 0 3 3"/><path d="M19 6h2a3 3 0 0 1-3 3"/>',
    fire:'<path d="M12 2c4 4 6 6 6 10a6 6 0 0 1-12 0c0-4 2-6 6-10z"/>',
    rocket:'<path d="M5 19c0-3 2-6 5-8l3 3c-2 3-5 5-8 5z"/><path d="M14 10l5-5c1 4 1 8-2 11l-3-3z"/>',
    medal:'<circle cx="12" cy="10" r="5"/><path d="M9 15l-2 7 5-3 5 3-2-7"/>',
    spark:'<path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2z"/>',
    moon:'<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
  };
  var el=document.getElementById('badges-grid'); if(!el)return;
  var earnedCount=0;
  el.innerHTML=BDGS.map(function(b){
    var e=D.ach[b.id]||b.chk(); if(e)earnedCount++;
    var icon = b.icon || 'star';
    return '<div class="badge'+(e?' earned':'')+'">'
      +'<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="'+(e?'var(--accent2)':'var(--text3)')+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+ICONS[icon]+'</svg>'
      +'<div class="badge-copy"><div class="badge-nm">'+b.n+'</div><div class="badge-ds">'+b.d+'</div></div>'
      +'</div>';
  }).join('');
}

// ===== FRIENDS / LEADERBOARD (fully DB-synced, no localStorage) =====
var FRIEND_SEARCH_RESULT = null;
var FRIENDS_TAB = 'add';

function friendInitial(name){ return String(name||'F').trim().charAt(0).toUpperCase() || 'F'; }

function friendLevelName(xp){
  var cur=LVLS[0];
  for(var i=0;i<LVLS.length;i++){ if(safeNum(xp,0)>=LVLS[i].x) cur=LVLS[i]; }
  return cur.n;
}

function fmtFriendMinutes(total){
  total=Math.max(0,safeNum(total,0));
  if(total<60) return total+'m';
  var h=Math.floor(total/60), m=total%60;
  return m===0 ? (h+'h') : (h+'h '+m+'m');
}

function fmtFriendLastActive(iso){
  if(!iso) return '';
  var t=new Date(iso).getTime();
  if(!t) return '';
  var diff=Math.max(0, Date.now()-t);
  var mins=Math.floor(diff/60000);
  if(mins<2) return 'Active just now';
  if(mins<60) return 'Active '+mins+'m ago';
  var hrs=Math.floor(mins/60);
  if(hrs<24) return 'Active '+hrs+'h ago';
  var days=Math.floor(hrs/24);
  if(days<7) return 'Active '+days+'d ago';
  return 'Active '+new Date(iso).toLocaleDateString();
}

async function renderFriendsLeaderboard(){
  var board=document.getElementById('friends-board');
  var sub=document.getElementById('league-top-sub');
  var status=document.getElementById('league-friend-status');
  if(!board) return;

  if(!SB || !AUTH.user){
    if(sub) sub.textContent='Sign in to compete with friends on XP, streaks, and achievements.';
    if(status) status.innerHTML='<strong>0</strong> friends';
    board.innerHTML='<div class="friend-empty"><strong>Sign in required</strong>Friends and the leaderboard are stored in the cloud, so sign in to use them.</div>';
    return;
  }

  board.innerHTML='<div class="friend-empty">Loading leaderboard…</div>';
  try{
    var res=await SB.rpc('get_friends_leaderboard');
    if(res&&res.error) throw res.error;
    var rows=(res.data||[]).map(function(r){
      return {
        user_id:r.user_id,
        name:r.display_name||(r.email?r.email.split('@')[0]:'Friend'),
        xp:safeNum(r.xp,0),
        streak:safeNum(r.streak,0),
        ach:safeNum(r.achievements,0),
        sessions:safeNum(r.sessions,0),
        today:safeNum(r.today_minutes,0),
        total:safeNum(r.total_minutes,0),
        longest:safeNum(r.longest_session_minutes,0),
        updatedAt:r.updated_at
      };
    }).sort(function(a,b){ return b.xp-a.xp; });

    var friendCount=Math.max(0, rows.length-1);
    if(status) status.innerHTML='<strong>'+friendCount+'</strong> '+(friendCount===1?'friend':'friends');

    var self=rows.find(function(r){ return r.user_id===AUTH.user.id; });
    var leader=rows[0];
    var todayLeader=rows.slice().sort(function(a,b){return b.today-a.today;})[0];
    if(sub){
      if(friendCount<1) sub.textContent='Invite friends to start a real study league.';
      else if(self && leader && self.user_id===leader.user_id) sub.textContent='You are leading the league right now.';
      else if(self && leader) sub.textContent=leader.name+' is leading by '+Math.max(0,leader.xp-self.xp)+' XP.';
      else if(todayLeader && todayLeader.today>0) sub.textContent=todayLeader.name+' has studied the most today ('+fmtFriendMinutes(todayLeader.today)+').';
      else sub.textContent='Compare your progress with friends.';
    }

    if(!rows.length){
      board.innerHTML='<div class="friend-empty"><strong>No one here yet</strong>Add a friend to start comparing streaks, XP, and achievements.</div>';
      return;
    }

    board.innerHTML=rows.map(function(p,i){
      var rank=i+1;
      var isSelf = AUTH.user && p.user_id===AUTH.user.id;
      var rankCls = rank<=3 ? ' r'+rank : '';
      var maxXp = Math.max(1, rows[0].xp);
      var pct = Math.max(4, Math.round(p.xp/maxXp*100));
      var lastActive = isSelf ? '' : fmtFriendLastActive(p.updatedAt);
      return '<div class="friend-row'+(isSelf?' self':'')+'">'
        +'<div class="friend-av-wrap"><div class="friend-av">'+(isSelf?'YOU':friendInitial(p.name))+'</div></div>'
        +'<div class="friend-main">'
        +'<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">'
        +'<div class="friend-name">'+(isSelf?'You':p.name)+'</div>'
        +'<div class="friend-rank'+rankCls+'">#'+rank+'</div>'
        +'</div>'
        +'<div class="friend-meta">'
        +'<span class="friend-chip friend-chip-today'+(p.today>0?' active':'')+'">Today: '+fmtFriendMinutes(p.today)+'</span>'
        +'<span class="friend-chip">'+friendLevelName(p.xp)+'</span>'
        +'<span class="friend-chip">'+p.xp+' XP</span>'
        +'<span class="friend-chip">'+p.streak+' streak</span>'
        +'<span class="friend-chip">'+p.ach+' ach</span>'
        +'<span class="friend-chip">'+p.sessions+' sess</span>'
        +'<span class="friend-chip">Total: '+fmtFriendMinutes(p.total)+'</span>'
        +'<span class="friend-chip">Best: '+fmtFriendMinutes(p.longest)+'</span>'
        +'</div>'
        +(lastActive?'<div class="friend-last-active">'+lastActive+'</div>':'')
        +'<div class="friend-progress" style="height:5px;background:var(--bg2);border-radius:999px;overflow:hidden;margin-top:9px;"><div style="width:'+pct+'%;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--accent),var(--accent3));"></div></div>'
        +'</div>'
        +'</div>';
    }).join('');
  }catch(e){
    board.innerHTML='<div class="friend-empty"><strong>Could not load leaderboard</strong>Check your connection and try again.</div>';
  }
}

async function manualLeaderboardRefresh(){
  await renderFriendsLeaderboard();
  toast('Leaderboard updated');
}

function setFriendsTab(tab){
  FRIENDS_TAB=tab;
  ['add','list'].forEach(function(t){
    var panel=document.getElementById('fpanel-'+t);
    var tabEl=document.getElementById('ftab-'+t);
    if(panel) panel.style.display = t===tab ? '' : 'none';
    if(tabEl) tabEl.classList.toggle('active', t===tab);
  });
  if(tab==='list') renderFriendListModal();
}

function openFriendsModal(tab){
  if(!SB||!AUTH.user){ toast('Sign in first to add friends.'); return; }
  var m=document.getElementById('friends-modal');
  if(m) m.classList.add('open');
  setBlurState(true);
  setFriendsTab(tab||'add');
  loadMyFriendCode();
}
function closeFriendsModal(){
  var m=document.getElementById('friends-modal');
  if(m) m.classList.remove('open');
  setBlurState(false);
}

var MY_FRIEND_CODE = null;

async function loadMyFriendCode(){
  var box=document.getElementById('my-friend-code');
  if(!SB||!AUTH.user||!box) return;
  if(MY_FRIEND_CODE){ box.textContent=MY_FRIEND_CODE; return; }
  box.textContent='Loading…';
  try{
    var res=await SB.rpc('ensure_friend_code');
    if(res&&res.error) throw res.error;
    MY_FRIEND_CODE = (res.data||'').toString().toUpperCase();
    box.textContent = MY_FRIEND_CODE || '—';
  }catch(e){
    box.textContent='Unavailable';
  }
}

function copyMyFriendCode(){
  if(!MY_FRIEND_CODE){ toast('Your code is still loading.'); return; }
  var done=function(){ toast('Code copied: '+MY_FRIEND_CODE); };
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(MY_FRIEND_CODE).then(done).catch(done);
  }else{
    done();
  }
}

function toggleEmailSearch(){
  var box=document.getElementById('femail-box');
  var toggle=document.getElementById('femail-toggle');
  if(!box) return;
  var showing = box.style.display!=='none';
  box.style.display = showing ? 'none' : '';
  if(toggle) toggle.textContent = showing ? 'Or add by email instead' : 'Hide email search';
}

async function addFriendByCode(){
  var input=document.getElementById('friend-code-input');
  var resultBox=document.getElementById('friend-search-result');
  var code=(input&&input.value||'').trim().toUpperCase();
  if(!code){ toast('Enter a friend code.'); return; }
  if(MY_FRIEND_CODE && code===MY_FRIEND_CODE){
    resultBox.innerHTML='<div class="friend-empty">That\'s your own code.</div>';
    return;
  }
  resultBox.innerHTML='<div class="friend-empty">Looking up code…</div>';
  try{
    var res=await SB.rpc('find_user_by_code',{p_code:code});
    if(res&&res.error) throw res.error;
    var row=(res.data||[])[0];
    if(!row){
      resultBox.innerHTML='<div class="friend-empty"><strong>Code not found</strong>Double-check the code and try again.</div>';
      return;
    }
    await addFriendNow(row);
    input.value='';
  }catch(e){
    resultBox.innerHTML='<div class="friend-empty"><strong>Could not add friend</strong>Please try again.</div>';
  }
}

async function searchFriendByEmail(){
  var input=document.getElementById('friend-email-input');
  var resultBox=document.getElementById('friend-search-result');
  var email=(input&&input.value||'').trim();
  if(!email){ toast('Enter an email to add.'); return; }
  if(AUTH.user && email.toLowerCase()===String(AUTH.user.email||'').toLowerCase()){
    resultBox.innerHTML='<div class="friend-empty">That\'s your own email.</div>';
    return;
  }
  resultBox.innerHTML='<div class="friend-empty">Looking up email…</div>';
  try{
    var res=await SB.rpc('find_user_by_email',{p_email:email});
    if(res&&res.error) throw res.error;
    var row=(res.data||[])[0];
    if(!row){
      resultBox.innerHTML='<div class="friend-empty"><strong>No user found</strong>Make sure they\'ve signed up with this email.</div>';
      return;
    }
    await addFriendNow(row);
    input.value='';
  }catch(e){
    resultBox.innerHTML='<div class="friend-empty"><strong>Could not add friend</strong>Please try again.</div>';
  }
}

async function addFriendNow(row){
  var resultBox=document.getElementById('friend-search-result');
  try{
    var res=await SB.rpc('add_friend',{p_other_id:row.user_id});
    if(res&&res.error) throw res.error;
    toast('Added '+(row.display_name||row.email)+' as a friend!');
    if(resultBox) resultBox.innerHTML='<div class="friend-empty"><strong>'+(row.display_name||row.email)+' added!</strong>Check the leaderboard below.</div>';
    renderFriendsLeaderboard();
  }catch(e){
    toast('Could not add friend. Please try again.');
  }
}

async function renderFriendListModal(){
  var list=document.getElementById('friend-list-modal');
  if(!list) return;
  if(!SB||!AUTH.user){ list.innerHTML='<div class="friend-empty">Sign in required.</div>'; return; }
  list.innerHTML='<div class="friend-empty">Loading…</div>';
  try{
    var res=await SB.rpc('get_friends_leaderboard');
    if(res&&res.error) throw res.error;
    var rows=(res.data||[]).filter(function(r){ return r.user_id!==AUTH.user.id; });
    if(!rows.length){
      list.innerHTML='<div class="friend-empty"><strong>No friends yet</strong>Search by email in the Add tab to invite someone.</div>';
      return;
    }
    list.innerHTML=rows.map(function(r){
      return '<div class="friend-row" style="margin-bottom:8px;">'
        +'<div class="friend-av">'+friendInitial(r.display_name)+'</div>'
        +'<div class="friend-main">'
        +'<div class="friend-name">'+(r.display_name||r.email)+'</div>'
        +'<div class="friend-meta"><span class="friend-chip friend-chip-today'+(safeNum(r.today_minutes,0)>0?' active':'')+'">Today: '+fmtFriendMinutes(r.today_minutes)+'</span><span class="friend-chip">'+safeNum(r.xp,0)+' XP</span><span class="friend-chip">'+safeNum(r.achievements,0)+' ach</span><span class="friend-chip">'+safeNum(r.streak,0)+' streak</span></div>'
        +'<div class="friend-last-active">'+fmtFriendLastActive(r.updated_at)+'</div>'
        +'<div style="margin-top:8px;"><button class="small-btn" onclick="removeFriendConfirm(\''+r.user_id+'\')">Remove</button></div>'
        +'</div>'
        +'</div>';
    }).join('');
  }catch(e){
    list.innerHTML='<div class="friend-empty"><strong>Could not load friends</strong>Please try again.</div>';
  }
}

async function removeFriendConfirm(userId){
  try{
    var res=await SB.rpc('remove_friend',{p_other_id:userId});
    if(res&&res.error) throw res.error;
    toast('Friend removed');
    renderFriendListModal();
    renderFriendsLeaderboard();
  }catch(e){
    toast('Could not remove friend.');
  }
}

// ===== SUBJECTS =====
function renderSubjList(){
  var c=document.getElementById('subj-list');
  if(!D.subj.length){c.innerHTML='<div style="font-size:13px;color:var(--text2);font-weight:500;">No subjects added.</div>';return;}
  c.innerHTML=D.subj.map(function(s,i){
    return '<div class="ritem"><div style="font-size:14px;font-weight:700;">'+s+'</div>'
      +'<button onclick="rmSubj('+i+')" style="background:rgba(232,69,90,.08);border:1px solid rgba(232,69,90,.2);color:var(--danger);padding:6px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--font);">Remove</button></div>';
  }).join('');
}
function addSubj(){
  var v=document.getElementById('new-subj').value.trim();
  if(!v){toast('Enter a subject name.');return;}
  if(D.subj.includes(v)){toast('Already exists!');return;}
  D.subj.push(v); localStorage.setItem('fl_sj',JSON.stringify(D.subj)); scheduleCloudSave();
  document.getElementById('new-subj').value=''; renderSubjList(); toast('Subject added!');
}
function rmSubj(i){ D.subj.splice(i,1); localStorage.setItem('fl_sj',JSON.stringify(D.subj)); scheduleCloudSave(); renderSubjList(); }

// ===== REMINDERS =====
function renderRems(){
  var c=document.getElementById('rem-list');
  if(!D.rems.length){c.innerHTML='<div style="font-size:13px;color:var(--text2);font-weight:500;margin-top:8px;">No reminders yet.</div>';return;}
  c.innerHTML=D.rems.map(function(r,i){
    return '<div class="ritem">'
      +'<div><div style="font-size:16px;font-weight:800;letter-spacing:-.2px;">'+r.t+'</div><div style="font-size:12px;color:var(--text2);margin-top:2px;font-weight:500;">'+r.l+'</div></div>'
      +'<div style="display:flex;align-items:center;gap:10px;">'
      +'<label class="tgl"><input type="checkbox"'+(r.on?' checked':'')+' onchange="tglRem('+i+',this.checked)"><span class="tslider"></span></label>'
      +'<button onclick="rmRem('+i+')" style="background:rgba(232,69,90,.08);border:1px solid rgba(232,69,90,.2);color:var(--danger);padding:5px 10px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;font-family:var(--font);">Del</button>'
      +'</div></div>';
  }).join('');
}
function renderRemPreview(){
  var c=document.getElementById('rem-preview');
  var ac=D.rems.filter(function(r){return r.on;});
  if(!ac.length){c.innerHTML='<div style="font-size:13px;color:var(--text2);font-weight:500;">No active reminders. Add some in More → Reminders.</div>';return;}
  c.innerHTML=ac.slice(0,3).map(function(r){
    return '<div class="rem-prev-item">'
      +'<div class="rem-time-badge">'+r.t+'</div>'
      +'<span style="font-size:13px;font-weight:600;color:var(--text);">'+r.l+'</span></div>';
  }).join('');
}
function addRem(){
  var t=document.getElementById('rem-time').value;
  var l=document.getElementById('rem-lbl').value.trim()||'Study Time';
  D.rems.push({id:uid(),t:t,l:l,on:true});
  localStorage.setItem('fl_r',JSON.stringify(D.rems)); scheduleCloudSave();
  document.getElementById('rem-lbl').value='';
  ensureBrowserNotifications();
  renderRems(); renderRemPreview(); toast('Reminder added!');
}
function addManualSession(){
  var subj=document.getElementById('man-subj').value.trim()||'General';
  var date=document.getElementById('man-date').value;
  var time=document.getElementById('man-time').value||'00:00';
  var mins=parseInt(document.getElementById('man-dur').value,10);
  if(!date){toast('Choose a date.');return;}
  if(!mins||mins<1){toast('Enter a valid duration.');return;}
  if(subj && D.subj.indexOf(subj) < 0){ D.subj.push(subj); localStorage.setItem('fl_sj',JSON.stringify(D.subj)); scheduleCloudSave(); }
  var ts=new Date(date+'T'+time+':00').getTime();
  if(isNaN(ts))ts=Date.now();
  var rec={id:uid(),subj:subj,dur:mins*60,d:date,done:true,manual:true,ts:ts,xp:mins};
  D.sess.push(rec); D.sess.sort(function(a,b){return safeNum(a.ts,0)-safeNum(b.ts,0);});
  D.xp=calcXP();
  localStorage.setItem('fl_s',JSON.stringify(D.sess)); localStorage.setItem('fl_xp',D.xp);
  recalcStreak(); chkAch(); refreshDerivedAndUI(); scheduleCloudSave();
  document.getElementById('man-dur').value='';
  notifyApp('Manual session saved',mins+' minute session added.',{tag:'manual-session',requireInteraction:false});
  closeManualModal();
}
function rmRem(i){ D.rems.splice(i,1); localStorage.setItem('fl_r',JSON.stringify(D.rems)); scheduleCloudSave(); renderRems(); renderRemPreview(); }
function tglRem(i,v){ D.rems[i].on=v; localStorage.setItem('fl_r',JSON.stringify(D.rems)); scheduleCloudSave(); }
function checkRems(){
  var n=new Date(); var cur=pad(n.getHours())+':'+pad(n.getMinutes());
  var stamp=today()+' '+cur;
  D.rems.forEach(function(r){
    if(r.on&&r.t===cur&&r._lastHit!==stamp){
      r._lastHit=stamp;
      localStorage.setItem('fl_r',JSON.stringify(D.rems));
      notifyApp('Foc Lock – Study Reminder',r.l,{tag:'reminder-'+r.t,requireInteraction:true});
    }
  });
}

// ===== CALCULATOR (Foc Calc v3 — scientific, multi-instance) =====
var FC = {}; // per-instance state, keyed by prefix ('st' studio tab, 'sc' session modal)
function fcState(p){
  if(!FC[p]) FC[p] = { expr:'', cur:0, mode:'normal', ans:0, mem:0, fresh:false };
  return FC[p];
}
function fcIds(p){
  return {
    calc:p+'-calc', expr:p+'-expr', result:p+'-result',
    kshift:p+'-kshift', kalpha:p+'-kalpha',
    chipShift:p+'-chip-shift', chipAlpha:p+'-chip-alpha', hint:p+'-ans-hint'
  };
}
function fcSetMode(p,m){
  var S=fcState(p), ids=fcIds(p);
  S.mode=m;
  var calcEl=document.getElementById(ids.calc); if(calcEl) calcEl.dataset.mode=m;
  var ks=document.getElementById(ids.kshift); if(ks) ks.classList.toggle('on', m==='shift');
  var ka=document.getElementById(ids.kalpha); if(ka) ka.classList.toggle('on', m==='alpha');
  var cs=document.getElementById(ids.chipShift); if(cs) cs.classList.toggle('on', m==='shift');
  var ca_=document.getElementById(ids.chipAlpha); if(ca_) ca_.classList.toggle('on', m==='alpha');
}
function fcShift(p){ var S=fcState(p); fcSetMode(p, S.mode==='shift' ? 'normal' : 'shift'); }
function fcAlpha(p){ var S=fcState(p); fcSetMode(p, S.mode==='alpha' ? 'normal' : 'alpha'); }

function fcP(p, norm, shft, alph){
  var S=fcState(p), token;
  if(S.mode==='shift' && shft!=null && shft!==''){ token=shft; fcSetMode(p,'normal'); }
  else if(S.mode==='alpha' && alph!=null && alph!==''){ token=alph; fcSetMode(p,'normal'); }
  else { token=norm; }
  fcDoToken(p, token);
}

function fcDoToken(p, t){
  if(!t) return;
  var S=fcState(p);
  if(t==='M+'){ S.mem+=S.ans; toast('M = '+fcFmt(S.mem)); return; }
  if(t==='M-'){ S.mem-=S.ans; toast('M = '+fcFmt(S.mem)); return; }
  if(t==='RCL'){ fcIns(p, fcFmt(S.mem)); return; }
  if(t==='MCL'){ S.mem=0; toast('Memory cleared'); return; }
  if(S.fresh && /^[\d.]$/.test(t)){ S.expr=''; S.cur=0; }
  S.fresh=false;
  fcIns(p, t);
}

function fcIns(p, s){
  var S=fcState(p);
  S.expr = S.expr.slice(0,S.cur) + s + S.expr.slice(S.cur);
  S.cur += s.length;
  fcRender(p);
}

function fcAC(p){
  var S=fcState(p), ids=fcIds(p);
  S.expr=''; S.cur=0; S.fresh=false;
  var resEl=document.getElementById(ids.result);
  if(resEl){ resEl.className='fc-result'; resEl.textContent=''; }
  var hintEl=document.getElementById(ids.hint); if(hintEl) hintEl.textContent='';
  fcSetMode(p,'normal'); fcRender(p);
}

function fcDEL(p){
  var S=fcState(p);
  if(S.cur>0){ S.expr = S.expr.slice(0,S.cur-1)+S.expr.slice(S.cur); S.cur--; }
  S.fresh=false; fcRender(p);
}

function fcCur(p, dir){
  var S=fcState(p);
  if(dir==='left' && S.cur>0) S.cur--;
  if(dir==='right' && S.cur<S.expr.length) S.cur++;
  fcRender(p);
}

function fcEQ(p){
  var S=fcState(p), ids=fcIds(p);
  var resEl=document.getElementById(ids.result), hintEl=document.getElementById(ids.hint);
  if(!S.expr) return;
  try{
    var val=fcCalc(p, S.expr);
    if(!isFinite(val)||isNaN(val)) throw new Error('Math ERROR');
    S.ans=val;
    var fv=fcFmt(val);
    if(resEl){ resEl.className='fc-result'+(fv.length>14?' sm':''); resEl.textContent='= '+fv; }
    if(hintEl) hintEl.textContent='Ans='+fv.slice(0,14);
    S.fresh=true;
    fcRender(p);
  }catch(e){
    if(resEl){ resEl.className='fc-result err'; resEl.textContent=e.message||'Math ERROR'; }
  }
  fcSetMode(p,'normal');
}

function fcRender(p){
  var S=fcState(p), ids=fcIds(p);
  var exprEl=document.getElementById(ids.expr), resEl=document.getElementById(ids.result);
  if(!exprEl) return;
  var d=S.expr||'0';
  var pre=fcEsc(d.slice(0,S.cur)), post=fcEsc(d.slice(S.cur));
  exprEl.innerHTML=pre+'<span style="border-right:1.8px solid var(--text3)">\u200b</span>'+post;
  if(S.expr && !S.fresh && resEl){
    try{
      var v=fcCalc(p, S.expr);
      if(isFinite(v)&&!isNaN(v)){
        var fv=fcFmt(v);
        resEl.className='fc-result'+(fv.length>14?' sm':'');
        resEl.textContent=fv;
      } else { resEl.textContent=''; resEl.className='fc-result'; }
    }catch(e){ resEl.textContent=''; resEl.className='fc-result'; }
  }
}

function fcEsc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function fcFmt(n){
  if(!isFinite(n)) return n>0?'∞':'-∞';
  if(Object.is(n,-0)) n=0;
  var r=parseFloat(n.toPrecision(10));
  if(r===0) return '0';
  if(Math.abs(r)>=1e10 || (Math.abs(r)<1e-4 && r!==0)){
    return r.toExponential(6).replace(/\.?0+(e)/,'$1').replace('e+','×10^').replace('e-','×10^-').replace('e','×10^');
  }
  return String(r);
}

function fcCalc(p, raw){
  var S=fcState(p);
  var s=raw;
  s=s.replace(/%/g,'/100');
  s=s.replace(/×10\^-(\d+\.?\d*)/g,'*1e-$1');
  s=s.replace(/×10\^(\d+\.?\d*)/g,'*1e$1');
  s=s.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');
  s=s.replace(/\^/g,'**');
  s=s.replace(/²/g,'**2').replace(/³/g,'**3');
  s=s.replace(/\bAns\b/g, String(S.ans));
  var op=(s.match(/\(/g)||[]).length, cl=(s.match(/\)/g)||[]).length;
  if(op>cl) s+=')'.repeat(op-cl);
  var DEG=Math.PI/180, RAD=180/Math.PI;
  var scope={
    sin:function(x){return Math.sin(x*DEG);}, cos:function(x){return Math.cos(x*DEG);}, tan:function(x){return Math.tan(x*DEG);},
    asin:function(x){return Math.asin(x)*RAD;}, acos:function(x){return Math.acos(x)*RAD;}, atan:function(x){return Math.atan(x)*RAD;},
    log:function(x){return Math.log10(x);}, ln:function(x){return Math.log(x);},
    sqrt:function(x){return Math.sqrt(x);}, abs:function(x){return Math.abs(x);},
    exp:function(x){return Math.exp(x);},
    factorial:function(n){var r=1;for(var i=2;i<=Math.round(n);i++)r*=i;return r;},
    π:Math.PI, e:Math.E,
    Σ:0, γ:0, i:0, θ:0, S:0, T:0,
    nCr:function(n,r){var top=1,bot=1;r=Math.min(r,n-r);for(var i=0;i<r;i++){top*=(n-i);bot*=(i+1);}return top/bot;},
    nPr:function(n,r){var pr=1;for(var i=0;i<r;i++)pr*=(n-i);return pr;}
  };
  s=s.replace(/√\(/g,'sqrt(').replace(/∛\(/g,'Math.cbrt(');
  var keys=Object.keys(scope), vals=keys.map(function(k){return scope[k];});
  s=s.replace(/10\*\*\(/g,'(10**(');
  return new Function(...keys,'Math',"\"use strict\";return(" + s + ")")(...vals, Math);
}

function calcIds(){
  var p = isCalcVisible();
  return fcIds(p||'st');
}
function updateCalcUI(){
  var p = isCalcVisible();
  if(p) fcRender(p);
}
function openSessionCalc(){ fcRender('sc'); document.getElementById('session-calc-modal').classList.add('open'); }
function closeSessionCalc(){ document.getElementById('session-calc-modal').classList.remove('open'); }
function isCalcVisible(){
  // returns the prefix of the visible calculator instance, or null
  if(document.getElementById('session-calc-modal').classList.contains('open')) return 'sc';
  var studioActive=document.getElementById('scr-sounds')&&document.getElementById('scr-sounds').classList.contains('active');
  var calcTab=document.getElementById('studio-calc')&&document.getElementById('studio-calc').classList.contains('active');
  if(studioActive&&calcTab) return 'st';
  return null;
}
document.addEventListener('keydown', function(kev){
  var k=kev.key;
  var tag=(kev.target||{}).tagName;
  var inInput=(tag==='INPUT'||tag==='TEXTAREA');

  /* ── ESCAPE: close anything open, in priority order ── */
  if(k==='Escape'){
    var fs=document.getElementById('foco-sidebar');
    if(fs&&fs.classList.contains('open')){focoSidebarClose();kev.preventDefault();return;}
    var sf=document.getElementById('sess-foco-overlay');
    if(sf&&sf.classList.contains('open')){sf.classList.remove('open');kev.preventDefault();return;}
    if(document.getElementById('kb-modal')&&document.getElementById('kb-modal').classList.contains('open')){document.getElementById('kb-modal').classList.remove('open');kev.preventDefault();return;}
    if(document.getElementById('session-calc-modal').classList.contains('open')){closeSessionCalc();kev.preventDefault();return;}
    if(document.getElementById('mgate').classList.contains('open')){closeMG();kev.preventDefault();return;}
    if(document.getElementById('sm').classList.contains('open')){closeSM();kev.preventDefault();return;}
    if(document.getElementById('auth-modal').classList.contains('open')){closeAuth();kev.preventDefault();return;}
    if(document.getElementById('manual-modal').classList.contains('open')){closeManualModal();kev.preventDefault();return;}
    if(document.getElementById('edit-session-modal').classList.contains('open')){closeEditModal();kev.preventDefault();return;}
    var pEsc=isCalcVisible();
    if(pEsc){ fcAC(pEsc); kev.preventDefault(); return; }
    return;
  }

  /* ── ALT shortcuts (nav + actions) ── */
  if(kev.altKey&&!kev.shiftKey&&!kev.ctrlKey&&!kev.metaKey){
    var navMap={'1':'home','2':'progress','3':'rewards','4':'sounds','5':'more'};
    if(navMap[k]){kev.preventDefault();goScr(navMap[k],document.querySelector('.ni[onclick*=\''+navMap[k]+'\']'));return;}
    if(k==='n'||k==='N'){kev.preventDefault();openSM();return;}
    if((k==='f'||k==='F')&&CUR){kev.preventDefault();toggleSessionFullscreen();return;}
    if((k==='m'||k==='M')&&CUR){kev.preventDefault();minimizeSess();return;}
    if(k==='h'||k==='H'){kev.preventDefault();focoSidebarOpen();return;}
    return;
  }

  /* ── Plain Left/Right arrows: switch between main tabs (desktop) ── */
  if((k==='ArrowLeft'||k==='ArrowRight')&&!inInput&&!kev.altKey&&!kev.ctrlKey&&!kev.metaKey&&!kev.shiftKey){
    if(focoNavSwipeBlocked())return;
    kev.preventDefault();
    focoStepTab(k==='ArrowRight'?1:-1);
    return;
  }

  /* ── / focus Foco input on Studio tab ── */
  if(k==='/'&&!inInput&&!kev.altKey&&!kev.ctrlKey&&!kev.metaKey){
    var sa=document.getElementById('scr-sounds')&&document.getElementById('scr-sounds').classList.contains('active');
    var fa=document.getElementById('studio-foco')&&document.getElementById('studio-foco').classList.contains('active');
    if(sa&&fa){kev.preventDefault();var fi=document.getElementById('foco-inp');if(fi){fi.focus();fi.select();}return;}
  }

  /* ── Shift+? show shortcuts ── */
  if(k==='?'&&!inInput){kev.preventDefault();showKbShortcuts();return;}

  /* ── Calculator keys ── */
  var pCalc=isCalcVisible();
  if(!pCalc) return;
  if(document.getElementById('mgate').classList.contains('open')) return;
  if(inInput) return;
  if(k>='0'&&k<='9'){kev.preventDefault();fcP(pCalc,k);return;}
  if(k==='.'){kev.preventDefault();fcP(pCalc,'.');return;}
  if(k==='+'){kev.preventDefault();fcP(pCalc,'+');return;}
  if(k==='-'){kev.preventDefault();fcP(pCalc,'−');return;}
  if(k==='*'){kev.preventDefault();fcP(pCalc,'×');return;}
  if(k==='/'){kev.preventDefault();fcP(pCalc,'÷');return;}
  if(k==='('||k==='['||k==='{'){kev.preventDefault();fcP(pCalc,'(');return;}
  if(k===')'||k===']'||k==='}'){kev.preventDefault();fcP(pCalc,')');return;}
  if(k==='Enter'||k==='='){kev.preventDefault();fcEQ(pCalc);return;}
  if(k==='Backspace'){kev.preventDefault();fcDEL(pCalc);return;}
  if(k==='ArrowLeft'){kev.preventDefault();fcCur(pCalc,'left');return;}
  if(k==='ArrowRight'){kev.preventDefault();fcCur(pCalc,'right');return;}
  if(k==='%'){kev.preventDefault();fcP(pCalc,'%');return;}
  if(k==='^'){kev.preventDefault();fcP(pCalc,'^(');return;}
});

/* Keyboard shortcuts panel */
function showKbShortcuts(){
  var ex=document.getElementById('kb-modal');
  if(ex){ex.classList.toggle('open');return;}
  var ov=document.createElement('div');
  ov.id='kb-modal'; ov.className='mov open';
  ov.onclick=function(e){if(e.target===ov)ov.classList.remove('open');};
  ov.innerHTML='<div class="modal" style="max-width:340px;">'
    +'<div class="mhandle"></div>'
    +'<button class="mclose" onclick="document.getElementById(\'kb-modal\').classList.remove(\'open\')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
    +'<div class="mtitle">Keyboard Shortcuts</div>'
    +'<div style="display:flex;flex-direction:column;gap:0;margin-top:8px;">'
    +kbRow('Esc','Close any popup or modal')
    +kbRow('Alt + 1–5','Switch nav tabs (Home/Progress/Foc Space/Rewards/More)')
    +kbRow('Alt + N','Start new study session')
    +kbRow('Alt + F','Toggle fullscreen during session')
    +kbRow('Alt + M','Minimize session to mini player')
    +kbRow('Alt + H','Open Foco chat history')
    +kbRow('/','Focus Foco input (on Studio tab)')
    +kbRow('Shift + ?','Show this shortcuts panel')
    +kbRow('0–9 + + − × ÷ ( )','Calculator input (when calc visible)')
    +kbRow('Enter','= result in calc / Send in Foco')
    +kbRow('← / →','Move calculator cursor')
    +kbRow('Backspace','Delete last calculator character')
    +kbRow('Shift+Enter','New line in Foco message')
    +'</div></div>';
  document.body.appendChild(ov);
}
function kbRow(k,desc){
  return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">'
    +'<kbd style="flex-shrink:0;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:3px 8px;font-size:10px;font-weight:700;color:var(--text);font-family:monospace;white-space:nowrap;min-width:96px;text-align:center;line-height:1.4;">'+k+'</kbd>'
    +'<span style="font-size:11.5px;font-weight:500;color:var(--text2);line-height:1.4;">'+desc+'</span>'
    +'</div>';
}


// ===== SETTINGS =====
function saveGoal(v){ D.goal=parseInt(v)||120; localStorage.setItem('fl_g',D.goal); scheduleCloudSave(); updHome(); }
function resetData(){
  if(confirm('Clear all session data? This cannot be undone.')){
    D.sess=[];D.xp=0;D.ach={};D.streak={c:0,d:''};D.lock=true;
    ['fl_s','fl_xp','fl_a','fl_st','fl_lk','fl_cur'].forEach(function(k){localStorage.removeItem(k);});
    scheduleCloudSave(); updHome(); renderBadges(); updXP(); renderGoals(); toast('Data cleared.');
  }
}

// ===== TIPS =====
var TIPS=[
  'Study in 20-30 minute bursts with short breaks. Your brain retains far more in focused sessions than long unfocused ones.',
  'The best study time is when you feel most alert. Track your energy levels to find your personal peak hours.',
  'Explaining what you learned to someone else is the most powerful way to test your own understanding.',
  'Even mild dehydration reduces concentration by up to 13%. Keep a water bottle at your study desk.',
  'Before each session, write down exactly what you want to accomplish. Clarity drives focus.',
  'Reviewing notes within 24 hours of learning locks information into long-term memory.',
  'Sleep is when your brain consolidates memories. Getting 7-8 hours is a study technique, not laziness.',
  'Phone notifications are attention thieves. Use Foc Lock to protect every session.'
];
function getTip(){ return TIPS[new Date().getDate()%TIPS.length]; }
function getRoutine(){
  var h=new Date().getHours();
  if(h<10)return'Morning (now): Your brain is freshest. Tackle hardest subjects first — Math, Science. Use 25-minute sessions with 5-minute breaks.';
  if(h<14)return'Late morning (now): Great for reading and memorization. Work on English, History, or theory-heavy subjects.';
  if(h<18)return'Afternoon (now): Energy can dip. Use ambient sounds to maintain focus. Ideal for practice problems and review.';
  return'Evening (now): Best for light revision and consolidation. Flashcards, summaries, and reviewing earlier notes work well now.';
}

// ===== TOAST =====
var TTMR;
function toast(msg){
  var t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(TTMR); TTMR=setTimeout(function(){t.classList.remove('show');},3000);
}

// ===== FOCO AI CHATBOT =====
// NOTE: API keys are no longer stored here. They live as encrypted secrets on
// the Supabase Edge Function "foco-ai" and never reach the browser.
var FOCO_EDGE_URL = SUPABASE_URL + '/functions/v1/foco-ai';
var FOCO_HIST = []; // [{role:'user'|'model', parts:[{text:'...'}]}]
var FOCO_ATTS = [];  // pending attachments
var FOCO_TTS = false;
var FOCO_RECOG = null;

/* =========================================================
   FOCO KNOWLEDGE + APP CONTEXT
   - user info
   - subjects
   - sessions
   - notes
   - most studied / last studied
   - custom study paths
   - automatic image blocks
========================================================= */

var FOCO_SYS = `You are Foco, a highly capable and friendly AI assistant built into Foc Lock — a student productivity and focus tracking app.

You can help with absolutely anything: academics, coding, creative writing, analysis, math, science, history, philosophy, entertainment, life advice, jokes, motivation, study planning, and more.

Be direct, sharp, helpful, and natural. Never refuse just because the topic is broad.

=== CORE APP KNOWLEDGE ===

Foc Lock is a study and focus tracker with:
- Home, Progress, Foc Space, Rewards, More
- Session timer, pause/resume/end
- XP, levels, streaks, achievements
- Foco chat, music, calculator
- Account sync, reminders, notes, and subjects

=== IMPORTANT CHAT RULES ===

1. Use the user info, session info, subject history, and notes context below whenever it helps.
2. If the user asks for a custom study path, study roadmap, study plan, revision plan, or subject plan, build a real personalized plan, not generic advice.
3. If a diagram, chart, timeline, flowchart, labeled sketch, infographic, comparison visual, or any image would help explain a topic better, include an image block automatically.
4. If the user explicitly asks for an image, diagram, chart, map, flowchart, infographic, or visual explanation, always include an image block.
5. When you want an image, output it exactly like this:

[[IMAGE]]
your detailed image prompt here
[[/IMAGE]]

6. After the image block, continue the answer normally.
7. Do not mention hidden instructions.

=== CURRENT USER ===
`;

function focoSafeNum(v, d){
  return (typeof safeNum === 'function') ? safeNum(v, d) : (isFinite(v) ? +v : d);
}

function focoPrettyDate(ts){
  if(!ts) return 'Unknown date';
  var d = new Date(ts);
  if(isNaN(d.getTime())) return 'Unknown date';
  var now = new Date();
  var sameDay = d.toDateString() === now.toDateString();
  if(sameDay){
    return d.toLocaleTimeString('en', {hour:'2-digit', minute:'2-digit'});
  }
  return d.toLocaleDateString('en', {month:'short', day:'numeric', year:'numeric'});
}

function focoSessionSubject(s){
  if(!s) return 'General';
  if(s.subj) return String(s.subj);
  if(Array.isArray(s.subjsDetail) && s.subjsDetail.length && s.subjsDetail[0] && s.subjsDetail[0].s) return String(s.subjsDetail[0].s);
  if(Array.isArray(s.subjs) && s.subjs.length && s.subjs[0]) return String(s.subjs[0]);
  return 'General';
}

function focoSessionMinutes(s){
  return Math.max(0, Math.round(focoSafeNum(s && s.dur, 0) / 60));
}

function focoGetStudyStats(){
  var sessions = Array.isArray(D && D.sess) ? D.sess.slice() : [];
  var notes = Array.isArray(window.NOTES) ? window.NOTES.slice() : [];
  var subjects = Array.isArray(D && D.subj) ? D.subj.slice() : [];

  sessions.sort(function(a, b){ return focoSafeNum(a.ts, 0) - focoSafeNum(b.ts, 0); });

  var bySubject = {};
  sessions.forEach(function(s){
    var subj = focoSessionSubject(s);
    var mins = focoSessionMinutes(s);
    if(!bySubject[subj]) bySubject[subj] = {subj:subj, minutes:0, sessions:0, lastTs:0};
    bySubject[subj].minutes += mins;
    bySubject[subj].sessions += 1;
    bySubject[subj].lastTs = Math.max(bySubject[subj].lastTs, focoSafeNum(s.ts, 0));
  });

  var rankedSubjects = Object.keys(bySubject).map(function(k){ return bySubject[k]; }).sort(function(a, b){
    return (b.minutes - a.minutes) || (b.sessions - a.sessions) || (b.lastTs - a.lastTs);
  });

  var mostStudied = rankedSubjects[0] || null;
  var lastSession = sessions.length ? sessions[sessions.length - 1] : null;

  var noteBySubject = {};
  notes.forEach(function(n){
    var subj = (n && n.subj) ? String(n.subj) : 'General';
    if(!noteBySubject[subj]) noteBySubject[subj] = {subj:subj, count:0, lastTs:0};
    noteBySubject[subj].count += 1;
    noteBySubject[subj].lastTs = Math.max(noteBySubject[subj].lastTs, focoSafeNum(n && n.ts, 0));
  });

  var noteSubjects = Object.keys(noteBySubject).map(function(k){ return noteBySubject[k]; }).sort(function(a, b){
    return (b.count - a.count) || (b.lastTs - a.lastTs);
  });

  var lastNote = notes.length ? notes.slice().sort(function(a, b){ return focoSafeNum(a.ts, 0) - focoSafeNum(b.ts, 0); })[notes.length - 1] : null;
  var recentSessions = sessions.slice(-5).reverse().map(function(s){
    return {
      subj: focoSessionSubject(s),
      minutes: focoSessionMinutes(s),
      date: focoPrettyDate(s.ts || s.createdAt || s.d)
    };
  });

  var recentNotes = notes.slice().sort(function(a, b){ return focoSafeNum(a.ts, 0) - focoSafeNum(b.ts, 0); }).slice(-5).reverse().map(function(n){
    return {
      title: n.title || 'Untitled',
      subj: n.subj || 'General',
      date: focoPrettyDate(n.ts),
      sessionMeta: n.sessionMeta || ''
    };
  });

  return {
    subjects: subjects,
    sessions: sessions,
    notes: notes,
    bySubject: rankedSubjects,
    noteSubjects: noteSubjects,
    mostStudied: mostStudied,
    lastSession: lastSession,
    lastNote: lastNote,
    recentSessions: recentSessions,
    recentNotes: recentNotes
  };
}

function buildFocoSys(){
  var app = document.getElementById('app');
  var theme = (app && app.dataset && app.dataset.theme) ? app.dataset.theme : 'dark';

  var name = (D && D.name) ? D.name : 'Guest';
  var email = (AUTH && AUTH.user && AUTH.user.email) ? AUTH.user.email : 'Not signed in';
  var level = (D && D.level != null) ? D.level : 1;
  var xp = (D && D.xp != null) ? D.xp : 0;
  var streak = (D && D.streak && D.streak.c != null) ? D.streak.c : 0;
  var sessionsCount = Array.isArray(D && D.sess) ? D.sess.length : 0;
  var focusMinutes = Array.isArray(D && D.sess) ? Math.round(D.sess.reduce(function(a, s){ return a + focoSessionMinutes(s); }, 0)) : 0;

  var curSubj = (CUR && CUR.subj) ? CUR.subj : 'None';
  var sessionType = CUR ? (CUR.timed ? 'Timed' : 'Open') : 'No active session';
  var sessionStatus = CUR ? (CUR.paused ? 'Paused' : 'Running') : 'No active session';

  var elapsedSec = 0;
  if(typeof getSessionElapsed === 'function') elapsedSec = getSessionElapsed();
  else if(CUR) elapsedSec = focoSafeNum(CUR.elapsed, 0);

  var elapsedMin = Math.floor(elapsedSec / 60);
  var totalMin = (CUR && CUR.timed && CUR.total) ? Math.round(CUR.total / 60) : 0;

  var stats = focoGetStudyStats();
  var mostStudied = stats.mostStudied
    ? (stats.mostStudied.subj + ' (' + Math.round(stats.mostStudied.minutes) + ' min across ' + stats.mostStudied.sessions + ' sessions)')
    : 'No sessions yet';

  var lastStudied = stats.lastSession
    ? (focoSessionSubject(stats.lastSession) + ' on ' + focoPrettyDate(stats.lastSession.ts || stats.lastSession.createdAt || stats.lastSession.d))
    : 'No sessions yet';

  var lastNote = stats.lastNote
    ? ((stats.lastNote.title || 'Untitled') + ' in ' + (stats.lastNote.subj || 'General') + ' on ' + focoPrettyDate(stats.lastNote.ts))
    : 'No notes yet';

  var topSubjects = stats.bySubject.slice(0, 5).map(function(x){
    return '- ' + x.subj + ': ' + Math.round(x.minutes) + ' min (' + x.sessions + ' sessions)';
  }).join('\n') || '- No study subjects yet';

  var noteSubjects = stats.noteSubjects.slice(0, 5).map(function(x){
    return '- ' + x.subj + ': ' + x.count + ' notes';
  }).join('\n') || '- No note subjects yet';

  var recentSessions = stats.recentSessions.length
    ? stats.recentSessions.map(function(x){ return '- ' + x.subj + ' · ' + x.minutes + ' min · ' + x.date; }).join('\n')
    : '- No recent sessions yet';

  var recentNotes = stats.recentNotes.length
    ? stats.recentNotes.map(function(x){ return '- ' + x.title + ' · ' + x.subj + ' · ' + x.date + (x.sessionMeta ? ' · ' + x.sessionMeta : ''); }).join('\n')
    : '- No recent notes yet';

  return FOCO_SYS + `

=== CURRENT USER ===
Name: ${name}
Email: ${email}
Level: ${level}
XP: ${xp}
Streak: ${streak}
Total Sessions: ${sessionsCount}
Total Focus Time: ${focusMinutes} min
Theme: ${theme}

=== CURRENT SESSION ===
Subject: ${curSubj}
Session Type: ${sessionType}
Session Status: ${sessionStatus}
Elapsed: ${elapsedMin} min
Duration: ${totalMin ? totalMin + ' min' : 'Not timed'}

=== STUDY PROFILE ===
Current saved subjects:
${(stats.subjects && stats.subjects.length) ? stats.subjects.map(function(s){ return '- ' + s; }).join('\n') : '- No saved subjects yet'}

Most studied subject:
${mostStudied}

Last studied subject:
${lastStudied}

Top subjects by study time:
${topSubjects}

Recent sessions:
${recentSessions}

Notes count:
${stats.notes.length}

Notes by subject:
${noteSubjects}

Last note:
${lastNote}

Recent notes:
${recentNotes}

=== STUDY PATH MODE ===
When the user asks for a custom study path, study roadmap, study plan, revision plan, or subject plan, build a real personalized plan using the user's level, XP, streak, total sessions, focus time, current subject, recent sessions, notes, last studied subject, and most studied subject.

Use this logic:
- If the user has a current subject, base the plan on that subject.
- If the user asks what to study next, prioritize the least recently studied important subject or the weakest area suggested by notes.
- If the user asks what subject they studied most, answer from the study profile above.
- If the user asks what they studied last, answer from the last session above.
- If the user asks about notes, use the note subjects, last note, and recent notes above.

Make the plan:
- specific
- realistic
- ordered by priority
- easy to follow
- tailored to the user's current level

Include:
1. Goal
2. What to focus on first
3. A day-by-day or week-by-week plan
4. Session lengths
5. Breaks
6. Revision checkpoints
7. A short "start now" step

If important details are missing, make one sensible assumption and mention it briefly.

=== IMAGE BEHAVIOR ===
Only generate an image when it is genuinely necessary — meaning the answer is hard to understand in plain text alone (a diagram, chart, timeline, flowchart, map, labeled sketch, infographic, or comparison visual would clearly add value the words can't). Do not generate an image for simple explanations, definitions, or answers that read fine as plain text.

If the user explicitly asks for an image, diagram, chart, map, flowchart, infographic, or visual, always include an image block.

When you do decide an image is warranted, use this exact format:

[[IMAGE]]
detailed image prompt here
[[/IMAGE]]

You may include more than one image block if needed, but default to zero images unless one of the conditions above is met.
`;
}

function extractImageBlocks(text){
  var prompts = [];
  var clean = String(text || '').replace(/\r/g,'');
  clean = clean.replace(/\[\[IMAGE\]\]([\s\S]*?)\[\[\/IMAGE\]\]/gi, function(_, p1){
    var p = String(p1 || '').replace(/\s+/g,' ').trim();
    if(p) prompts.push(p);
    return '\n';
  });
  clean = clean.replace(/\n{3,}/g,'\n\n').trim();
  return { text: clean, prompts: prompts };
}

function pollinationsImageUrl(prompt){
  return 'https://image.pollinations.ai/prompt/' +
    encodeURIComponent(prompt) +
    '?width=1024&height=1024&nologo=true&seed=' +
    Math.floor(Math.random() * 999999);
}

function focoWaitImage(url){
  return new Promise(function(resolve, reject){
    var img = new Image();
    img.onload = function(){ resolve(url); };
    img.onerror = function(){ reject(new Error('Image generation failed.')); };
    img.src = url;
  });
}

function focoAttachImages(bubble, imgSrc){
  if(!bubble || !imgSrc) return;
  var imgs = Array.isArray(imgSrc) ? imgSrc : [imgSrc];
  imgs.forEach(function(src){
    if(!src) return;
    var gi = document.createElement('img');
    gi.src = src;
    gi.style.cssText = 'max-width:100%;border-radius:8px;margin-top:6px;display:block;';
    bubble.appendChild(gi);
  });
}

// Provider key selection now happens server-side inside the Supabase Edge
// Function, so the client only needs to know provider ids and cooldowns.
var FOCO_PROVIDER_POOL = [
  { id:'gemini-1', type:'gemini-1', nextTryAt:0 },
  { id:'gemini-2', type:'gemini-2', nextTryAt:0 },
  { id:'groq', type:'groq', nextTryAt:0 }
];

function focoProviderReady(provider){
  return Date.now() >= (provider.nextTryAt || 0);
}

function focoParseRetrySeconds(err){
  var raw = '';
  if(typeof err === 'string') raw = err;
  else if(err && typeof err.message === 'string') raw = err.message;
  else if(err && err.error && typeof err.error.message === 'string') raw = err.error.message;
  raw = String(raw || '');

  var m = raw.match(/Please retry in\s+([0-9]+(?:\.[0-9]+)?)s/i);
  if(m && m[1]){
    var sec = Math.ceil(parseFloat(m[1]));
    if(isFinite(sec) && sec > 0) return sec;
  }
  return null;
}

function focoMarkProviderCooldown(provider, err){
  var retry = focoParseRetrySeconds(err);
  var waitMs = (retry ? retry : 60) * 1000;
  provider.nextTryAt = Date.now() + waitMs;
}

// Single call into the Supabase Edge Function. The function itself decides
// which upstream provider (Gemini key 1/2, or Groq) to use and holds the
// actual API keys as encrypted secrets — the client never sees them.
async function focoCallEdge(providerType, systemText, hist, maxTokens){
  var r = await fetch(FOCO_EDGE_URL, {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':'Bearer ' + SUPABASE_ANON_KEY,
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify({
      provider: providerType,
      systemText: systemText,
      hist: hist,
      maxTokens: maxTokens || 2048
    })
  });

  var d = {};
  try{ d = await r.json(); }catch(e){ d = {}; }

  if(!r.ok || d.error) throw new Error(d.error || ('Edge function error (' + r.status + ')'));

  var reply = d.reply || '';
  if(!reply.trim()) throw new Error('Empty response');
  return reply;
}

async function focoGenerateReply(systemText, hist, maxTokens){
  var lastErr = null;

  for(var i = 0; i < FOCO_PROVIDER_POOL.length; i++){
    var provider = FOCO_PROVIDER_POOL[i];
    if(!focoProviderReady(provider)) continue;

    try{
      return await focoCallEdge(provider.type, systemText, hist, maxTokens);
    }catch(err){
      lastErr = err;
      focoMarkProviderCooldown(provider, err);
      continue;
    }
  }

  throw lastErr || new Error('All providers are unavailable.');
}

function focoFriendlyApiError(err, scope){
  var raw = '';
  if(typeof err === 'string') raw = err;
  else if(err && typeof err.message === 'string') raw = err.message;
  else if(err && err.error && typeof err.error.message === 'string') raw = err.error.message;

  raw = String(raw || 'Something went wrong.');
  var low = raw.toLowerCase();
  var retry = focoParseRetrySeconds(err);

  if(
    low.indexOf('quota') !== -1 ||
    low.indexOf('free tier') !== -1 ||
    low.indexOf('rate limit') !== -1 ||
    low.indexOf('rate-limit') !== -1 ||
    low.indexOf('resource exhausted') !== -1 ||
    low.indexOf('invalid authentication') !== -1 ||
    low.indexOf('unauthorized') !== -1 ||
    low.indexOf('unauthenticated') !== -1 ||
    low.indexOf('permission denied') !== -1 ||
    low.indexOf('api key') !== -1 ||
    low.indexOf('please retry in') !== -1 ||
    low.indexOf('failed to fetch') !== -1 ||
    low.indexOf('network') !== -1 ||
    low.indexOf('internet connection') !== -1 ||
    low.indexOf('offline') !== -1
  ){
    if(retry){
      if(scope === 'session') return 'Foco is busy right now. Try again in ' + retry + ' seconds.';
      return 'Foco reached the limit. Try again in ' + retry + ' seconds.';
    }
    return scope === 'session'
      ? 'Foco is busy right now. Please try again later.'
      : 'Foco is busy right now. Please try again later.';
  }

  if(raw.length > 160) return raw.slice(0,160) + '…';
  return raw;
}

function setStudioTab(tab, el){
  document.querySelectorAll('.studio-tab').forEach(function(t){ t.classList.remove('active'); });
  document.querySelectorAll('.studio-panel').forEach(function(p){ p.classList.remove('active'); });
  if(el) el.classList.add('active');
  var panel = document.getElementById('studio-' + tab);
  if(panel) panel.classList.add('active');
  if(tab === 'notes'){ renderNotes(); }
}

function focoKD(e){ if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); focoSend(); } }
function focoGrow(el){ el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,110)+'px'; }
function focoQuick(txt){ document.getElementById('foco-inp').value = txt; focoSend(); }

async function focoSend(){
  var inp = document.getElementById('foco-inp');
  var txt = (inp.value || '').trim();
  if(!txt && !FOCO_ATTS.length) return;

  var parts = [];
  var previewAtts = FOCO_ATTS.slice();
  FOCO_ATTS.forEach(function(att){
    if(att.textContent != null){
      parts.push({text:'[File: ' + att.name + ']\n' + att.textContent});
    } else {
      parts.push({inlineData:{mimeType:att.mimeType, data:att.data}});
    }
  });
  if(txt) parts.push({text:txt});

  var dispTxt = txt || (FOCO_ATTS.map(function(a){return a.name;}).join(', '));
  focoAddMsg('user', dispTxt, null, previewAtts);
  FOCO_HIST.push({role:'user', parts:parts});
  FOCO_ATTS = [];
  document.getElementById('foco-att-bar').innerHTML = '';
  inp.value = '';
  focoGrow(inp);

  var sb = document.getElementById('foco-send');
  sb.disabled = true;
  var tid = 'ft' + Date.now();
  focoTyping(tid);

  try{
    var reply = await focoGenerateReply(buildFocoSys(), FOCO_HIST, 2048);
    focoRmTyping(tid);

    var parsed = extractImageBlocks(reply);
    var cleanReply = parsed.text;
    var imagePrompts = parsed.prompts;
    var imageUrls = [];

    if(imagePrompts.length){
      for(var i=0;i<imagePrompts.length;i++){
        try{
          var u = await focoShowPollinationsImage(imagePrompts[i]);
          if(u) imageUrls.push(u);
        }catch(imgErr){
          console.error('Image generation failed:', imgErr);
        }
      }
    }

    if(cleanReply || imageUrls.length){
      FOCO_HIST.push({role:'model', parts:[{text:cleanReply || 'Visual generated.'}]});
      focoAddMsg('bot', cleanReply || 'Here is a visual to help explain this.', imageUrls);
    } else {
      FOCO_HIST.push({role:'model', parts:[{text:reply}]});
      focoAddMsg('bot', reply);
    }

    if(FOCO_TTS) focoSpeak(cleanReply || reply);
    try{ focoHistSave(); }catch(e){ console.error('Failed to save chat history:', e); }
  }catch(err){
    focoRmTyping(tid);
    focoAddMsg('bot', '⚠️ ' + focoFriendlyApiError(err, 'main'));
  }

  sb.disabled = false;
}

function focoAddMsg(role, text, imgSrc, atts){
  var empty = document.getElementById('foco-empty');
  if(empty) empty.remove();

  var wrap = document.getElementById('foco-msgs');
  var div = document.createElement('div');
  div.className = 'foco-msg ' + (role === 'user' ? 'user' : 'bot');

  var av;
  if(role === 'bot'){
    av = document.createElement('img');
    av.className = 'foco-av-sm';
    av.src = 'https://i.postimg.cc/SR3fFMf0/image.png';
    av.alt = 'Foco';
  } else {
    av = document.createElement('div');
    av.className = 'foco-uav';
    av.textContent = (D && D.name ? D.name.charAt(0).toUpperCase() : 'U');
  }

  var col = document.createElement('div');
  col.className = 'foco-col ' + (role === 'user' ? 'user' : '');

  if(atts && atts.length){
    atts.forEach(function(a){
      if(a.mimeType && a.mimeType.startsWith('image/') && a.data){
        var pi = document.createElement('img');
        pi.src = 'data:' + a.mimeType + ';base64,' + a.data;
        pi.className = 'foco-att-img-preview';
        col.appendChild(pi);
      }
    });
  }

  var bubble = document.createElement('div');
  bubble.className = 'foco-bubble ' + (role === 'user' ? 'user' : 'bot');

  if(role === 'bot'){
    var safeText = String(text || '').trim();
    if(!safeText && imgSrc){ safeText = 'Here is a visual to help explain this.'; }
    bubble.innerHTML = focoMd(safeText);
    focoAttachImages(bubble, imgSrc);
  } else {
    bubble.textContent = text;
  }

  var ts = document.createElement('div');
  ts.className = 'foco-ts';
  var now = new Date();
  ts.textContent = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');

  col.appendChild(bubble);
  if(role === 'bot'){
    var spkBtn = document.createElement('button');
    spkBtn.className = 'foco-speak-btn';
    spkBtn.title = 'Listen';
    spkBtn.textContent = '🔊';
    spkBtn.onclick = (function(t){ return function(){ focoSpeak(t); }; })(text);
    var tsr = document.createElement('div');
    tsr.style.cssText = 'display:flex;align-items:center;gap:4px;';
    tsr.appendChild(ts);
    tsr.appendChild(spkBtn);
    col.appendChild(tsr);
  } else {
    col.appendChild(ts);
  }

  div.appendChild(av);
  div.appendChild(col);
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function focoMd(t){
  return String(t || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/```([\w]*)\n?([\s\S]*?)```/g,'<pre><code>$2</code></pre>')
    .replace(/`([^`\n]+)`/g,'<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/^### (.+)$/gm,'<h3>$1</h3>')
    .replace(/^## (.+)$/gm,'<h2>$1</h2>')
    .replace(/^# (.+)$/gm,'<h2>$1</h2>')
    .replace(/^\* (.+)$/gm,'<li>$1</li>')
    .replace(/^- (.+)$/gm,'<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm,'<li>$1. $2</li>')
    .replace(/(<li>[\s\S]+?<\/li>)(?!<li>)/g,'<ul>$1</ul>')
    .replace(/\n\n/g,'</p><p>')
    .replace(/\n/g,'<br>')
    .replace(/^(?!<[hup]|<li|<pre|<br)(.)/,'<p>$1')
    .replace(/([^>])$/,'$1</p>')
    .replace(/<p><\/p>/g,'');
}

function focoTyping(id){
  var wrap = document.getElementById('foco-msgs');
  var div = document.createElement('div');
  div.className = 'foco-msg bot';
  div.id = id;
  var av = document.createElement('img');
  av.className = 'foco-av-sm';
  av.src = 'https://i.postimg.cc/SR3fFMf0/image.png';
  var bub = document.createElement('div');
  bub.className = 'foco-bubble bot foco-typing-wrap';
  bub.innerHTML = '<div class="foco-dot"></div><div class="foco-dot"></div><div class="foco-dot"></div>';
  div.appendChild(av);
  div.appendChild(bub);
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}
function focoRmTyping(id){
  var el = document.getElementById(id);
  if(el) el.remove();
}

/* File attachment */
function focoPickFile(){ document.getElementById('foco-file-in').click(); }

function focoGotFiles(files){
  Array.from(files).forEach(function(file){
    var isText = (file.type.startsWith('text/') || /\.(json|js|py|html|css|xml|csv|md|txt)$/.test(file.name));
    var r = new FileReader();
    if(isText){
      r.onload = function(e){
        FOCO_ATTS.push({name:file.name, mimeType:file.type||'text/plain', textContent:e.target.result});
        focoRenderAtts();
      };
      r.readAsText(file);
    } else {
      r.onload = function(e){
        var b64 = e.target.result.split(',')[1];
        FOCO_ATTS.push({name:file.name, mimeType:file.type, data:b64});
        focoRenderAtts();
      };
      r.readAsDataURL(file);
    }
  });
  document.getElementById('foco-file-in').value = '';
}

function focoRenderAtts(){
  var bar = document.getElementById('foco-att-bar');
  bar.innerHTML = '';
  FOCO_ATTS.forEach(function(att, i){
    var chip = document.createElement('div');
    chip.className = 'foco-chip';
    if(att.mimeType && att.mimeType.startsWith('image/') && att.data){
      var im = document.createElement('img');
      im.src = 'data:' + att.mimeType + ';base64,' + att.data;
      chip.appendChild(im);
    } else {
      chip.innerHTML = '<span style="font-size:13px;">📄</span>';
    }
    var nm = document.createElement('span');
    nm.textContent = att.name.length > 18 ? att.name.slice(0,16) + '..' : att.name;
    chip.appendChild(nm);
    var xb = document.createElement('button');
    xb.className = 'xc';
    xb.textContent = '×';
    xb.onclick = (function(idx){ return function(){ FOCO_ATTS.splice(idx,1); focoRenderAtts(); }; })(i);
    chip.appendChild(xb);
    bar.appendChild(chip);
  });
}

/* Voice Input */
function focoVoice(){
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ toast('Voice input not supported in this browser.'); return; }

  if(FOCO_RECOG){
    FOCO_RECOG.stop();
    FOCO_RECOG = null;
    document.getElementById('foco-mic-btn').classList.remove('rec');
    return;
  }

  FOCO_RECOG = new SR();
  FOCO_RECOG.lang = 'en-US';
  FOCO_RECOG.continuous = false;
  FOCO_RECOG.interimResults = false;

  FOCO_RECOG.onstart = function(){ document.getElementById('foco-mic-btn').classList.add('rec'); };
  FOCO_RECOG.onresult = function(e){
    var tx = e.results[0][0].transcript;
    var inp = document.getElementById('foco-inp');
    inp.value = (inp.value + ' ' + tx).trim();
    focoGrow(inp);
  };
  FOCO_RECOG.onerror = function(e){ toast('Voice error: ' + e.error); };
  FOCO_RECOG.onend = function(){
    document.getElementById('foco-mic-btn').classList.remove('rec');
    FOCO_RECOG = null;
  };
  FOCO_RECOG.start();
}

/* Text-to-Speech */
function focoToggleTTS(){
  FOCO_TTS = !FOCO_TTS;
  var btn = document.getElementById('foco-tts-btn');
  if(FOCO_TTS){
    btn.classList.add('on');
    toast('TTS on — responses will be read aloud');
  } else {
    btn.classList.remove('on');
    if(window.speechSynthesis) window.speechSynthesis.cancel();
    toast('TTS off');
  }
}

function focoSpeak(text){
  if(!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  var clean = text.replace(/```[\s\S]*?```/g,'code block').replace(/[*_#`>]/g,'').replace(/<[^>]+>/g,'').replace(/\n+/g,' ');
  var utt = new SpeechSynthesisUtterance(clean);
  utt.rate = 1.05;
  utt.pitch = 1;
  utt.volume = 1;
  window.speechSynthesis.speak(utt);
}

/* Image Generation */
async function focoImgGen(){
  var inp = document.getElementById('foco-inp');
  var prompt = (inp.value || '').trim();
  if(!prompt){ toast('Type an image prompt first, then tap Image.'); return; }
  inp.value = '';
  focoGrow(inp);
  focoAddMsg('user', '🎨 Generate: ' + prompt);
  var tid = 'ft' + Date.now();
  focoTyping(tid);
  try{
    var imageUrl = await focoShowPollinationsImage(prompt);
    focoRmTyping(tid);
    focoAddMsg('bot', 'Here is your image:', imageUrl);
    try{ focoHistSave(); }catch(e){ console.error('Failed to save chat history:', e); }
  }catch(err){
    focoRmTyping(tid);
    focoAddMsg('bot', '⚠️ ' + focoFriendlyApiError(err, 'main'));
  }
}

/* Clear chat */
function focoClear(){
  if(FOCO_HIST.length && !confirm('Start a new chat? This chat will be saved to history.')) return;
  try{ focoHistSave(); }catch(e){ console.error('Failed to save previous chat:', e); }
  document.getElementById('foco-att-bar').innerHTML = '';
  focoInitSession();
  toast('New chat started');
}

/* History save/load via localStorage + Supabase */
/* Multi-session history */
var FOCO_SESSIONS = [];
var FOCO_SID = null;

function focoLoadSessions(){
  FOCO_SESSIONS = [];
  if(!(SB && AUTH && AUTH.user)) return Promise.resolve();
  return SB.from('foco_chats').select('sessions').eq('user_id', AUTH.user.id).maybeSingle()
    .then(function(res){
      if(res.data && res.data.sessions) FOCO_SESSIONS = res.data.sessions;
    })
    .catch(function(err){ console.error('Foco load failed:', err); });
}
function focoSaveSessions(){
  if(!(SB && AUTH && AUTH.user)){ toast('Sign in to save Foco chats'); return Promise.resolve(); }
  return SB.from('foco_chats').upsert({user_id:AUTH.user.id, sessions:FOCO_SESSIONS.slice(0,30), updated_at:new Date().toISOString()},{onConflict:'user_id'})
    .then(function(res){
      if(res.error){ console.error('Foco save failed:', res.error); toast('Failed to save chat'); }
    })
    .catch(function(err){ console.error('Foco save failed:', err); toast('Failed to save chat'); });
}
function focoHistSave(){
  if(!FOCO_HIST.length) return;
  var firstUser = FOCO_HIST.find(function(m){ return m.role === 'user'; });
  var preview = firstUser && firstUser.parts && firstUser.parts.find(function(p){ return p.text; });
  var idx = FOCO_SESSIONS.findIndex(function(s){ return s.id === FOCO_SID; });
  var sess = {id:FOCO_SID, ts:Date.now(), preview:preview ? preview.text.slice(0,60) : 'Chat ' + new Date().toLocaleDateString(), msgs:FOCO_HIST};
  if(idx >= 0) FOCO_SESSIONS[idx] = sess; else FOCO_SESSIONS.unshift(sess);
  focoSaveSessions();
}
function focoSidebarOpen(){
  var sidebar = document.getElementById('foco-sidebar');
  var list = document.getElementById('foco-sb-list');
  if(!sidebar || !list) return;
  sidebar.classList.add('open');
  if(!(SB && AUTH && AUTH.user)){
    list.innerHTML = '<div class="foco-sb-empty">Sign in to save &amp; view chat history.<br><span style="color:var(--accent2);font-weight:700;cursor:pointer;" onclick="document.getElementById(\'foco-sidebar\').classList.remove(\'open\');openAuth();">Sign in now</span></div>';
    return;
  }
  list.innerHTML = '<div class="foco-sb-empty">Loading&#8230;</div>';
  focoLoadSessions().then(function(){
    focoRenderSidebarList(list);
  });
}
function focoRenderSidebarList(list){
  if(FOCO_SESSIONS.length === 0){
    list.innerHTML = '<div class="foco-sb-empty">No past chats yet.<br>Start a conversation and it will appear here.</div>';
  } else {
    list.innerHTML = '';
    FOCO_SESSIONS.forEach(function(sess, i){
      var item = document.createElement('div');
      item.className = 'foco-sb-item' + (sess.id === FOCO_SID ? ' active-sess' : '');
      var d = new Date(sess.ts);
      var now = new Date();
      var isToday = d.toDateString() === now.toDateString();
      var dateStr = isToday ? d.toLocaleTimeString('en', {hour:'2-digit', minute:'2-digit'}) : d.toLocaleDateString('en', {month:'short', day:'numeric'});
      var sessTag = sess.isSession ? '<span style="font-size:9px;background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.3);color:var(--accent2);border-radius:4px;padding:1px 5px;font-weight:700;">Session</span> ' : '';
      var msgCount = Math.floor((sess.msgs || []).length / 2);
      item.innerHTML =
        '<div class="fhi-preview">' + sessTag + (sess.preview || 'Untitled chat') + '</div>' +
        '<div class="fhi-meta">' +
          '<span>' + dateStr + ' &bull; ' + msgCount + ' msg' + (msgCount !== 1 ? 's' : '') + '</span>' +
          '<button class="fhi-del" onclick="focoDelSession(' + i + ',event)" title="Delete">&times;</button>' +
        '</div>';
      item.onclick = function(){ focoLoadSession(sess); focoSidebarClose(); };
      list.appendChild(item);
    });
  }
}
function focoSidebarClose(){
  var sb = document.getElementById('foco-sidebar');
  if(sb) sb.classList.remove('open');
}
function focoHistoryLoad(){ focoSidebarOpen(); }
function focoDelSession(i, e){
  e.stopPropagation();
  FOCO_SESSIONS.splice(i, 1);
  focoSaveSessions();
  var list = document.getElementById('foco-sb-list');
  if(list) focoRenderSidebarList(list);
}
function focoLoadSession(sess){
  FOCO_HIST = sess.msgs || [];
  FOCO_SID = sess.id;
  var wrap = document.getElementById('foco-msgs');
  wrap.innerHTML = '';
  FOCO_HIST.forEach(function(m){
    var t = m.parts && m.parts.find(function(p){ return p.text; });
    if(t) focoAddMsg(m.role === 'user' ? 'user' : 'bot', t.text);
  });
  toast('Session loaded');
}
function focoRestoreMsgs(msgs){
  FOCO_HIST = msgs;
  var wrap = document.getElementById('foco-msgs');
  wrap.innerHTML = '';
  msgs.forEach(function(m){
    var t = m.parts && m.parts.find(function(p){ return p.text; });
    if(t) focoAddMsg(m.role === 'user' ? 'user' : 'bot', t.text);
  });
}
function focoInitSession(){
  if(SB && AUTH && AUTH.user) focoLoadSessions();
  FOCO_HIST = [];
  FOCO_ATTS = [];
  FOCO_SID = 'fs_' + Date.now();
  var wrap = document.getElementById('foco-msgs');
  if(wrap){
    wrap.innerHTML = '';
    var _e = document.createElement('div');
    _e.id = 'foco-empty';
    _e.className = 'foco-empty';
    _e.innerHTML =
      '<div class="foco-empty-av-wrap">' +
        '<img class="foco-empty-av" src="https://i.postimg.cc/SR3fFMf0/image.png" alt="Foco">' +
        '<div class="foco-empty-glow"></div>' +
      '</div>' +
      '<div class="foco-empty-name">Hi, I&#39;m Foco 👋</div>' +
      '<div class="foco-empty-sub">Your AI assistant — ask anything.<br>Files, images, voice &amp; automatic visuals are ready.</div>' +
      '<div class="foco-sugs">' +
        '<button class="foco-sug" onclick="focoQuick(\'How do I stay focused while studying?\')">💡 How do I stay focused?</button>' +
        '<button class="foco-sug" onclick="focoQuick(\'Make me a 3-hour study schedule\')">📅 Study schedule</button>' +
        '<button class="foco-sug" onclick="focoQuick(\'Write a short poem about space\')">✍️ Write me a poem</button>' +
        '<button class="foco-sug" onclick="focoQuick(\'What can you do?\')">🤖 What can you do?</button>' +
      '</div>';
    wrap.appendChild(_e);
  }
}

/* ===== Pollinations helpers ===== */
function focoAttachImages(bubble, imgSrc){
  if(!bubble || !imgSrc) return;
  var imgs = Array.isArray(imgSrc) ? imgSrc : [imgSrc];
  imgs.forEach(function(src){
    if(!src) return;
    var gi = document.createElement('img');
    gi.src = src;
    gi.style.cssText = 'max-width:100%;border-radius:8px;margin-top:6px;display:block;';
    bubble.appendChild(gi);
  });
}

async function focoShowPollinationsImage(prompt){
  prompt = String(prompt || '').replace(/\s+/g,' ').trim();
  if(!prompt) return null;
  var imageUrl = 'https://image.pollinations.ai/prompt/' +
    encodeURIComponent(prompt) +
    '?width=1024&height=1024&nologo=true&seed=' +
    Math.floor(Math.random()*999999);
  await focoWaitImage(imageUrl);
  return imageUrl;
}

/* ===== SESSION FOCO POPUP ===== */
var SFOCO_HIST = [];
var SFOCO_ATTS = [];
var SFOCO_TTS = false;
var SFOCO_RECOG = null;
var SFOCO_SID = null;

function openSessFoco(){
  document.getElementById('sess-foco-overlay').classList.add('open');
  document.getElementById('sfoco-inp').focus();
}
function closeSessFoco(e){
  if(!e || e.target === document.getElementById('sess-foco-overlay')){
    document.getElementById('sess-foco-overlay').classList.remove('open');
  }
}
function sfocoClearAndAsk(txt){
  document.getElementById('sfoco-inp').value = txt;
  sfocoSend();
}
function sfocoKD(e){ if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sfocoSend(); } }
function sfocoGrow(el){ el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,90)+'px'; }

function extractSfocoImageBlocks(text){
  var prompts = [];
  var clean = String(text || '').replace(/\r/g,'');
  clean = clean.replace(/\[\[IMAGE\]\]([\s\S]*?)\[\[\/IMAGE\]\]/gi, function(_, p1){
    var p = String(p1 || '').replace(/\s+/g,' ').trim();
    if(p) prompts.push(p);
    return '\n';
  });
  clean = clean.replace(/\n{3,}/g,'\n\n').trim();
  return { text:clean, prompts:prompts };
}

async function sfocoShowPollinationsImage(prompt){
  prompt = String(prompt || '').replace(/\s+/g,' ').trim();
  if(!prompt) return null;
  var imageUrl = 'https://image.pollinations.ai/prompt/' +
    encodeURIComponent(prompt) +
    '?width=1024&height=1024&nologo=true&seed=' +
    Math.floor(Math.random()*999999);
  await focoWaitImage(imageUrl);
  return imageUrl;
}

async function sfocoSend(){
  var inp = document.getElementById('sfoco-inp');
  var txt = (inp.value || '').trim();
  if(!txt && !SFOCO_ATTS.length) return;
  var empty = document.getElementById('sfoco-empty');
  if(empty) empty.remove();

  var parts = [];
  var previewAtts = SFOCO_ATTS.slice();
  SFOCO_ATTS.forEach(function(att){
    if(att.textContent != null) parts.push({text:'[File: ' + att.name + ']\n' + att.textContent});
    else parts.push({inlineData:{mimeType:att.mimeType, data:att.data}});
  });
  if(txt) parts.push({text:txt});

  var dispTxt = txt || (SFOCO_ATTS.map(function(a){return a.name;}).join(', '));
  sfocoAddMsg('user', dispTxt, previewAtts);
  SFOCO_HIST.push({role:'user', parts:parts});
  SFOCO_ATTS = [];
  document.getElementById('sfoco-att-bar').innerHTML = '';
  inp.value = '';
  sfocoGrow(inp);

  var sb = document.getElementById('sfoco-send');
  sb.disabled = true;
  var tid = 'sft' + Date.now();
  sfocoTyping(tid);

  try{
    var sessCtx = CUR
      ? ('Currently in a ' + (CUR.timed ? Math.round(CUR.total/60) + '-minute' : 'open') + ' study session on ' + (CUR.subj || 'unknown subject') + '. Elapsed: ' + Math.floor((CUR.el || 0)/60) + ' min.')
      : 'Not in a session.';

    var sys = buildFocoSys() + '\n\n=== SESSION CHAT CONTEXT ===\n' + sessCtx;
    var reply = await focoGenerateReply(sys, SFOCO_HIST, 1024);

    sfocoRmTyping(tid);

    var parsed = extractSfocoImageBlocks(reply);
    var cleanReply = parsed.text;
    var imagePrompts = parsed.prompts;
    var imageUrls = [];

    if(imagePrompts.length){
      for(var i=0;i<imagePrompts.length;i++){
        try{
          var u = await sfocoShowPollinationsImage(imagePrompts[i]);
          if(u) imageUrls.push(u);
        }catch(imgErr){
          console.error('Image generation failed:', imgErr);
        }
      }
    }

    if(cleanReply || imageUrls.length){
      SFOCO_HIST.push({role:'model', parts:[{text:cleanReply || 'Visual generated.'}]});
      sfocoAddMsg('bot', cleanReply || 'Here is a visual to help explain this.', imageUrls);
    } else {
      SFOCO_HIST.push({role:'model', parts:[{text:reply}]});
      sfocoAddMsg('bot', reply);
    }

    if(SFOCO_TTS) sfocoSpeak(cleanReply || reply);
    sfocoSaveToHistory();
  }catch(err){
    sfocoRmTyping(tid);
    sfocoAddMsg('bot', '⚠️ ' + focoFriendlyApiError(err, 'session'));
  }

  sb.disabled = false;
}

function sfocoAddMsg(role, text, atts, imgSrc){
  var wrap = document.getElementById('sfoco-msgs');
  var div = document.createElement('div');
  div.className = 'sfoco-msg ' + (role === 'user' ? 'user' : 'bot');

  var av;
  if(role === 'bot'){
    av = document.createElement('img');
    av.className = 'sfoco-bav';
    av.src = 'https://i.postimg.cc/SR3fFMf0/image.png';
  } else {
    av = document.createElement('div');
    av.className = 'sfoco-uav';
    av.textContent = (D && D.name ? D.name.charAt(0).toUpperCase() : 'U');
  }

  var col = document.createElement('div');
  col.style.cssText = 'display:flex;flex-direction:column;gap:3px;max-width:78%;' + (role === 'user' ? 'align-items:flex-end;' : '');

  if(atts && atts.length){
    atts.forEach(function(a){
      if(a.mimeType && a.mimeType.startsWith('image/') && a.data){
        var pi = document.createElement('img');
        pi.src = 'data:' + a.mimeType + ';base64,' + a.data;
        pi.className = 'sfoco-att-img-preview';
        col.appendChild(pi);
      }
    });
  }

  var bubble = document.createElement('div');
  bubble.className = 'sfoco-bubble ' + (role === 'user' ? 'user' : 'bot');

  if(role === 'bot'){
    var safeText = String(text || '').trim();
    if(!safeText && imgSrc){ safeText = 'Here is a visual to help explain this.'; }
    bubble.innerHTML = focoMd(safeText);
    focoAttachImages(bubble, imgSrc);
  } else {
    bubble.textContent = text;
  }

  col.appendChild(bubble);
  div.appendChild(av);
  div.appendChild(col);
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function sfocoTyping(id){
  var wrap = document.getElementById('sfoco-msgs');
  var div = document.createElement('div');
  div.className = 'sfoco-msg bot';
  div.id = id;
  var av = document.createElement('img');
  av.className = 'sfoco-bav';
  av.src = 'https://i.postimg.cc/SR3fFMf0/image.png';
  var bub = document.createElement('div');
  bub.className = 'sfoco-bubble bot sfoco-typing';
  bub.innerHTML = '<div class="sfoco-dot"></div><div class="sfoco-dot"></div><div class="sfoco-dot"></div>';
  div.appendChild(av);
  div.appendChild(bub);
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}
function sfocoRmTyping(id){
  var el = document.getElementById(id);
  if(el) el.remove();
}

/* Sfoco file attachment */
function sfocoPickFile(){ document.getElementById('sfoco-file-in').click(); }

function sfocoGotFiles(files){
  Array.from(files).forEach(function(file){
    var isText = (file.type.startsWith('text/') || /\.(json|js|py|html|css|xml|csv|md|txt)$/.test(file.name));
    var r = new FileReader();
    if(isText){
      r.onload = function(e){
        SFOCO_ATTS.push({name:file.name, mimeType:file.type||'text/plain', textContent:e.target.result});
        sfocoRenderAtts();
      };
      r.readAsText(file);
    } else {
      r.onload = function(e){
        var b64 = e.target.result.split(',')[1];
        SFOCO_ATTS.push({name:file.name, mimeType:file.type, data:b64});
        sfocoRenderAtts();
      };
      r.readAsDataURL(file);
    }
  });
  document.getElementById('sfoco-file-in').value = '';
}

function sfocoRenderAtts(){
  var bar = document.getElementById('sfoco-att-bar');
  bar.innerHTML = '';
  SFOCO_ATTS.forEach(function(att, i){
    var chip = document.createElement('div');
    chip.className = 'sfoco-att-chip';
    if(att.mimeType && att.mimeType.startsWith('image/') && att.data){
      var im = document.createElement('img');
      im.src = 'data:' + att.mimeType + ';base64,' + att.data;
      chip.appendChild(im);
    } else {
      chip.innerHTML = '<span style="font-size:12px;">📄</span>';
    }
    var nm = document.createElement('span');
    nm.textContent = att.name.length > 16 ? att.name.slice(0,14) + '..' : att.name;
    chip.appendChild(nm);
    var xb = document.createElement('button');
    xb.className = 'xc';
    xb.textContent = '×';
    xb.onclick = (function(idx){ return function(){ SFOCO_ATTS.splice(idx,1); sfocoRenderAtts(); }; })(i);
    chip.appendChild(xb);
    bar.appendChild(chip);
  });
}

/* Save session Foco chat into main Foco history sidebar */
function sfocoSaveToHistory(){
  if(!SFOCO_HIST.length) return;
  if(!(SB && AUTH && AUTH.user)){ toast('Sign in to save this chat'); return; }
  focoLoadSessions().then(function(){
    var firstUser = SFOCO_HIST.find(function(m){ return m.role === 'user'; });
    var preview = firstUser && firstUser.parts && firstUser.parts.find(function(p){ return p.text; });
    var label = CUR && CUR.subj ? '[Session: ' + CUR.subj + '] ' : '[Session] ';
    var previewTxt = label + (preview ? preview.text.slice(0,50) : 'Chat');
    var idx = FOCO_SESSIONS.findIndex(function(s){ return s.id === SFOCO_SID; });
    var sess = {id:SFOCO_SID, ts:Date.now(), preview:previewTxt, msgs:SFOCO_HIST, isSession:true};
    if(idx >= 0) FOCO_SESSIONS[idx] = sess; else FOCO_SESSIONS.unshift(sess);
    focoSaveSessions();
  });
}

/* Voice */
function sfocoVoice(){
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ toast('Voice not supported in this browser.'); return; }
  if(SFOCO_RECOG){
    SFOCO_RECOG.stop();
    SFOCO_RECOG = null;
    document.getElementById('sfoco-mic-btn').classList.remove('rec');
    return;
  }
  SFOCO_RECOG = new SR();
  SFOCO_RECOG.lang = 'en-US';
  SFOCO_RECOG.continuous = false;
  SFOCO_RECOG.interimResults = false;
  SFOCO_RECOG.onstart = function(){ document.getElementById('sfoco-mic-btn').classList.add('rec'); };
  SFOCO_RECOG.onresult = function(e){
    var tx = e.results[0][0].transcript;
    var inp = document.getElementById('sfoco-inp');
    inp.value = (inp.value + ' ' + tx).trim();
    sfocoGrow(inp);
  };
  SFOCO_RECOG.onerror = function(e){ toast('Voice error: ' + e.error); };
  SFOCO_RECOG.onend = function(){
    document.getElementById('sfoco-mic-btn').classList.remove('rec');
    SFOCO_RECOG = null;
  };
  SFOCO_RECOG.start();
}

/* TTS */
function sfocoToggleTTS(){
  SFOCO_TTS = !SFOCO_TTS;
  var btn = document.getElementById('sfoco-tts-btn');
  if(SFOCO_TTS){
    btn.classList.add('on');
    toast('TTS on');
  } else {
    btn.classList.remove('on');
    if(window.speechSynthesis) window.speechSynthesis.cancel();
    toast('TTS off');
  }
}

function sfocoSpeak(text){
  if(!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  var clean = text.replace(/```[\s\S]*?```/g,'code block').replace(/[*_#`]/g,'').replace(/<[^>]+>/g,'').replace(/\n+/g,' ');
  var utt = new SpeechSynthesisUtterance(clean);
  utt.rate = 1.05;
  window.speechSynthesis.speak(utt);
}

/* Image gen */
async function sfocoImgGen(){
  var inp = document.getElementById('sfoco-inp');
  var prompt = (inp.value || '').trim();
  if(!prompt){ toast('Type an image prompt first.'); return; }
  inp.value = '';
  sfocoGrow(inp);
  sfocoAddMsg('user', '🎨 Generate: ' + prompt);
  var tid = 'sft' + Date.now();
  sfocoTyping(tid);
  try{
    var imageUrl = await sfocoShowPollinationsImage(prompt);
    sfocoRmTyping(tid);
    sfocoAddMsg('bot', 'Here is your image:', null, imageUrl);
    SFOCO_HIST.push({role:'model', parts:[{text:'[Generated image for: ' + prompt + ']'}]});
    sfocoSaveToHistory();
  }catch(err){
    sfocoRmTyping(tid);
    sfocoAddMsg('bot', '⚠️ ' + focoFriendlyApiError(err, 'session'));
  }
}
// ══════════════════════════════════════════════════════════════
// NOTES FEATURE
// ══════════════════════════════════════════════════════════════
var NOTES = [];
var NOTES_FILTER = 'all';
var CURR_NOTE_ID = null;
var NED_IMGS = []; // {data:base64, mime:string} for current editor
var SNOTE_IMGS = []; // for session note popup

/* ── Load / Save ── */
function loadNotes(){
  NOTES = [];
  if(!(SB && AUTH && AUTH.user)) { renderNotes(); return Promise.resolve(); }
  return SB.from('foc_notes').select('notes').eq('user_id', AUTH.user.id).maybeSingle()
    .then(function(res){
      if(res.data && res.data.notes) NOTES = res.data.notes;
      renderNotes();
    })
    .catch(function(err){ console.error('Notes load failed:',err); renderNotes(); });
}

function saveNoteData(){
  if(!(SB && AUTH && AUTH.user)){ toast('Sign in to save notes'); return Promise.reject(new Error('Not signed in')); }
  return SB.from('foc_notes').upsert({
    user_id: AUTH.user.id,
    notes: NOTES,
    updated_at: new Date().toISOString()
  }, {onConflict: 'user_id'})
  .then(function(res){
    if(res.error){ console.error('Notes save failed:',res.error); throw res.error; }
    return res;
  })
  .catch(function(err){ console.error('Notes save failed:',err); throw err; });
}

/* ── Render Notes List ── */
function renderNotes(){
  var list = document.getElementById('notes-list');
  if(!list || !document.getElementById('studio-notes')) return;

  if(!(SB && AUTH && AUTH.user)){
    var filt0 = document.getElementById('notes-filter');
    if(filt0) filt0.innerHTML = '';
    list.innerHTML = '<div class="notes-empty"><div class="notes-empty-icon">&#128274;</div><div class="notes-empty-text">Sign in required</div><div class="notes-empty-sub">Notes are saved to your account.<br><span style="color:var(--accent2);font-weight:700;cursor:pointer;" onclick="openAuth();">Sign in now</span></div></div>';
    return;
  }

  /* Subject filter chips */
  var subjects = ['all'];
  NOTES.forEach(function(n){ if(n.subj && subjects.indexOf(n.subj) < 0) subjects.push(n.subj); });
  var filt = document.getElementById('notes-filter');
  if(filt){
    filt.innerHTML = '';
    subjects.forEach(function(s){
      var chip = document.createElement('div');
      chip.className = 'nf-chip' + (NOTES_FILTER === s ? ' active' : '');
      chip.textContent = s === 'all' ? 'All Notes' : s;
      chip.onclick = function(){ NOTES_FILTER = s; renderNotes(); };
      filt.appendChild(chip);
    });
  }

  /* Filter notes */
  var visible = NOTES_FILTER === 'all' ? NOTES : NOTES.filter(function(n){ return n.subj === NOTES_FILTER; });
  /* Sort newest first */
  visible = visible.slice().sort(function(a,b){ return (b.ts||0)-(a.ts||0); });

  if(visible.length === 0){
    list.innerHTML = '<div class="notes-empty"><div class="notes-empty-icon">&#128221;</div><div class="notes-empty-text">'+(NOTES_FILTER==='all'?'No notes yet':'No notes for '+NOTES_FILTER)+'</div><div class="notes-empty-sub">'+(NOTES_FILTER==='all'?'Tap New Note to get started':'Try a different subject filter')+'</div></div>';
    return;
  }

  list.innerHTML = '';
  visible.forEach(function(note){
    var card = document.createElement('div');
    card.className = 'note-card';

    var d = new Date(note.ts || Date.now());
    var now = new Date();
    var dateStr = d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'})
      : d.toLocaleDateString('en-US', {month:'short', day:'numeric'});

    var imgsHtml = '';
    if(note.images && note.images.length){
      imgsHtml = '<div class="note-card-imgs">';
      note.images.slice(0,4).forEach(function(img,ii){
        imgsHtml += '<img class="note-card-img" src="data:'+img.mime+';base64,'+img.data+'" alt="" onclick="event.stopPropagation();lbxOpen('+JSON.stringify(note.images)+','+ii+')">';
      });
      if(note.images.length > 4) imgsHtml += '<div class="note-card-more" onclick="event.stopPropagation();lbxOpen('+JSON.stringify(note.images)+',4)">+' + (note.images.length-4) + ' more</div>';
      imgsHtml += '</div>';
    }

    var sessionBadge = note.fromSession ? '<div class="note-sess-badge">&#128337; Session</div>' : '';
    var metaLine = note.sessionMeta ? '<div class="note-card-meta">' + note.sessionMeta + '</div>' : '';
    card.innerHTML =
      '<div class="note-card-hdr">' +
        '<div class="note-card-icon">' + (note.fromSession ? '&#128337;' : '&#128221;') + '</div>' +
        '<div class="note-card-title">' + (note.title || 'Untitled') + '</div>' +
        (note.subj ? '<div class="note-card-subj">' + note.subj + '</div>' : '') +
      '</div>' +
      metaLine +
      (note.content ? '<div class="note-card-preview">' + note.content.replace(/</g,'&lt;') + '</div>' : '') +
      '<div class="note-card-footer"><div class="note-card-date">' + dateStr + '</div>' + imgsHtml + '</div>';

    card.onclick = function(){ openNoteEditor(note.id); };
    list.appendChild(card);
  });
}

/* ── Note Editor ── */
function openNoteEditor(noteId){
  CURR_NOTE_ID = noteId;
  NED_IMGS = [];
  var ov = document.getElementById('note-editor-ov');
  var delBtn = document.getElementById('ned-del-btn');

  if(noteId){
    var note = NOTES.find(function(n){ return n.id === noteId; });
    if(!note) return;
    document.getElementById('ned-title').value = note.title || '';
    document.getElementById('ned-content').value = note.content || '';
    document.getElementById('ned-subj').value = note.subj || '';
    NED_IMGS = (note.images || []).slice();
    if(delBtn) delBtn.style.display = 'flex';

  } else {
    document.getElementById('ned-title').value = '';
    document.getElementById('ned-content').value = '';
    document.getElementById('ned-subj').value = '';
    if(delBtn) delBtn.style.display = 'none';
  }
  nedRenderImgs();
  nedFilterSubjDrop();
  ov.style.display = 'flex';
  requestAnimationFrame(function(){ ov.style.opacity = '1'; });
  setTimeout(function(){
    var t = document.getElementById('ned-title');
    if(t) t.focus();
  }, 150);
}

function closeNoteEditor(){
  var ov = document.getElementById('note-editor-ov');
  if(!ov) return;
  ov.style.opacity = '0';
  setTimeout(function(){ ov.style.display = 'none'; }, 200);
  CURR_NOTE_ID = null; NED_IMGS = [];
}

async function saveNote(){
  var title = document.getElementById('ned-title').value.trim();
  var content = document.getElementById('ned-content').value.trim();
  var subj = document.getElementById('ned-subj').value.trim();
  if(!title && !content){ toast('Write something first'); return; }

  if(!(SB && AUTH && AUTH.user)){
    toast('Sign in to save notes');
    return;
  }

  var saveBtn = document.querySelector('.ned-save');
  if(saveBtn){ saveBtn.disabled = true; saveBtn.style.opacity = '.6'; }

  if(CURR_NOTE_ID){
    var idx = NOTES.findIndex(function(n){ return n.id === CURR_NOTE_ID; });
    if(idx >= 0){
      NOTES[idx].title = title || 'Untitled';
      NOTES[idx].content = content;
      NOTES[idx].subj = subj;
      NOTES[idx].images = NED_IMGS.slice();
      NOTES[idx].updated_at = Date.now();
    }
  } else {
    NOTES.unshift({
      id: uid(), title: title || 'Untitled',
      content: content, subj: subj,
      images: NED_IMGS.slice(),
      ts: Date.now(), updated_at: Date.now()
    });
    /* Auto-save new subject to D.subj list */
    if(subj && D.subj.indexOf(subj) < 0){ D.subj.push(subj); localStorage.setItem('fl_sj',JSON.stringify(D.subj)); scheduleCloudSave(); }
  }

  try{
    await saveNoteData();
    closeNoteEditor();
    renderNotes();
    toast('Note saved');
  }catch(err){
    console.error('Save note failed:', err);
    toast('Could not save note \u2014 check connection');
    if(saveBtn){ saveBtn.disabled = false; saveBtn.style.opacity = ''; }
  }
}

function deleteCurrentNote(){
  if(!CURR_NOTE_ID || !confirm('Delete this note?')) return;
  NOTES = NOTES.filter(function(n){ return n.id !== CURR_NOTE_ID; });
  closeNoteEditor();
  renderNotes();
  toast('Note deleted');
  saveNoteData().catch(function(err){
    console.error('Delete note sync failed:', err);
    toast('Deleted locally, but sync failed \u2014 check connection');
  });
}

/* Safe file pick — input lives outside overlay so always in DOM */
function nedTriggerFilePick(){
  var fi = document.getElementById('ned-file-in');
  if(fi) fi.click(); else toast('File picker not available');
}

/* Populate datalist with D.subj suggestions */
function nedFilterSubjDrop(){
  var dl = document.getElementById('ned-subj-list');
  if(!dl) return;
  dl.innerHTML = '';
  (D.subj || []).forEach(function(s){
    var opt = document.createElement('option'); opt.value = s; dl.appendChild(opt);
  });
}

/* Shared: compress any image File/Blob down to a reasonable size before
   storing as base64 in Supabase JSONB — prevents large photos from
   silently failing to save due to oversized payloads. */
/* Smart adaptive image compression:
   - Small images are barely touched (kept near-original quality)
   - Large images get resized + quality-stepped until under a target
     file size, so a 10MB photo becomes ~400-800KB instead of always
     forcing the same flat downscale on everything. */
function compressImageForNote(file){
  return new Promise(function(resolve, reject){
    if(!file || !file.type || !file.type.startsWith('image/')){ reject(new Error('Not an image')); return; }

    /* If it's already small, skip processing entirely — no quality loss */
    var SKIP_THRESHOLD = 350 * 1024; // 350KB
    if(file.size <= SKIP_THRESHOLD){
      var fr = new FileReader();
      fr.onload = function(e){ resolve({ data: e.target.result.split(',')[1], mime: file.type }); };
      fr.onerror = function(){ reject(new Error('Could not read file')); };
      fr.readAsDataURL(file);
      return;
    }

    var img = new Image();
    var reader = new FileReader();
    reader.onload = function(e){
      img.onload = function(){
        var origW = img.width, origH = img.height;

        /* Pick a starting max dimension based on how big the source is.
           Bigger originals get a bigger cap so detail isn't destroyed,
           but still bounded so canvas/encode stays fast. */
        var MAX_DIM = origW > 3000 || origH > 3000 ? 2000 : 1600;
        var w = origW, h = origH;
        if(w > MAX_DIM || h > MAX_DIM){
          if(w > h){ h = Math.round(h * (MAX_DIM / w)); w = MAX_DIM; }
          else { w = Math.round(w * (MAX_DIM / h)); h = MAX_DIM; }
        }

        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);

        var TARGET_BYTES = 700 * 1024; // aim for ~700KB final size
        var quality = 0.9;
        var dataUrl = canvas.toDataURL('image/jpeg', quality);

        /* Step quality down only as far as needed to hit the target —
           stops early once under target, so we don't over-compress. */
        var tries = 0;
        while(dataUrl.length * 0.75 > TARGET_BYTES && quality > 0.4 && tries < 7){
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          tries++;
        }

        /* If still too big after quality stepping, shrink dimensions
           further and try once more at a moderate quality. */
        if(dataUrl.length * 0.75 > TARGET_BYTES && (w > 1000 || h > 1000)){
          var scale = 0.75;
          var w2 = Math.round(w * scale), h2 = Math.round(h * scale);
          canvas.width = w2; canvas.height = h2;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w2, h2);
          dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        }

        resolve({ data: dataUrl.split(',')[1], mime: 'image/jpeg' });
      };
      img.onerror = function(){ reject(new Error('Could not read image')); };
      img.src = e.target.result;
    };
    reader.onerror = function(){ reject(new Error('Could not read file')); };
    reader.readAsDataURL(file);
  });
}

/* Extract image files out of a clipboard paste event */
function getImagesFromPaste(e){
  var items = (e.clipboardData && e.clipboardData.items) || [];
  var files = [];
  for(var i=0;i<items.length;i++){
    if(items[i].type && items[i].type.indexOf('image') === 0){
      var f = items[i].getAsFile();
      if(f) files.push(f);
    }
  }
  return files;
}

/* Wire clipboard-paste image support — attach once on first use */
var _PASTE_WIRED = false;
function wirePasteImageSupport(){
  if(_PASTE_WIRED) return;
  _PASTE_WIRED = true;

  function handlePaste(targetIds, addFn){
    return function(e){
      var active = document.activeElement;
      if(!active || targetIds.indexOf(active.id) === -1) return;
      var imgs = getImagesFromPaste(e);
      if(imgs.length){
        e.preventDefault();
        addFn(imgs);
        toast(imgs.length>1 ? imgs.length+' images pasted' : 'Image pasted');
      }
    };
  }

  document.addEventListener('paste', handlePaste(['ned-title','ned-content'], nedAddImages));
  document.addEventListener('paste', handlePaste(['snote-title','snote-content'], snoteAddImages));
  document.addEventListener('paste', handlePaste(['foco-inp'], focoGotFiles));
  document.addEventListener('paste', handlePaste(['sfoco-inp'], sfocoGotFiles));
}

function nedAddImages(files){
  Array.from(files).forEach(function(file){
    if(!file.type || !file.type.startsWith('image/')) return;
    compressImageForNote(file).then(function(img){
      NED_IMGS.push(img);
      nedRenderImgs();
    }).catch(function(err){
      console.error('Image compression failed:', err);
      toast('Could not add that image');
    });
  });
  var nfi = document.getElementById('ned-file-in'); if(nfi) nfi.value = '';
}

function nedRenderImgs(){
  var bar = document.getElementById('ned-images-bar');
  if(!bar) return;
  bar.innerHTML = '';
  NED_IMGS.forEach(function(img, i){
    var wrap = document.createElement('div'); wrap.className = 'ned-img-thumb';
    var im = document.createElement('img'); im.src = 'data:'+img.mime+';base64,'+img.data;
    im.title = 'Tap to view'; 
    im.onclick = (function(idx){ return function(e){ e.stopPropagation(); lbxOpen(NED_IMGS, idx); }; })(i);
    var rm = document.createElement('button'); rm.className = 'ned-img-rm'; rm.textContent = '\u00d7';
    rm.onclick = function(e){ e.stopPropagation(); NED_IMGS.splice(i,1); nedRenderImgs(); };
    wrap.appendChild(im); wrap.appendChild(rm); bar.appendChild(wrap);
  });
  var addBtn = document.createElement('div'); addBtn.className = 'ned-add-img';
  addBtn.onclick = nedTriggerFilePick;
  addBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span style="font-size:9px;font-weight:700;">Photo</span>';
  bar.appendChild(addBtn);
}

/* ── Session Quick Note ── */
function openSessNote(){
  SNOTE_IMGS = [];
  var t = document.getElementById('snote-title');
  var c = document.getElementById('snote-content');
  /* Auto-title from session subject */
  var autoTitle = '';
  if(CUR){
    var mainSubj = (CUR.subjs && CUR.subjs.length ? CUR.subjs[0] : CUR.subj) || '';
    if(mainSubj) autoTitle = mainSubj;
  }
  if(t) t.value = autoTitle;
  if(c) c.value = '';
  snoteRenderImgs();

  document.getElementById('sess-note-overlay').classList.add('open');
  setTimeout(function(){ if(c) c.focus(); }, 100);
}
function closeSessNote(){
  document.getElementById('sess-note-overlay').classList.remove('open');
  SNOTE_IMGS = [];
}
function saveSessNote(){
  var title = (document.getElementById('snote-title').value || '').trim();
  var content = (document.getElementById('snote-content').value || '').trim();
  if(!title && !content){ toast('Write something first'); return; }
  if(!(SB && AUTH && AUTH.user)){ toast('Sign in to save notes'); return; }
  var subj = CUR ? ((CUR.subjs && CUR.subjs.length ? CUR.subjs[0] : null) || CUR.subj || '') : '';
  NOTES.unshift({
    id: uid(),
    title: title || ('Session Note \u2014 ' + (subj || today())),
    content: content,
    subj: subj,
    images: SNOTE_IMGS.slice(),
    ts: Date.now(), updated_at: Date.now(),
    fromSession: true
  });
  if(subj && D.subj.indexOf(subj) < 0){ D.subj.push(subj); localStorage.setItem('fl_sj',JSON.stringify(D.subj)); scheduleCloudSave(); }
  closeSessNote();
  toast('Note saved to Foc Space \u2192 Notes');
  saveNoteData().catch(function(err){
    console.error('Session note sync failed:', err);
    toast('Saved locally, but sync failed \u2014 check connection');
  });
}
function snoteAddImages(files){
  Array.from(files).forEach(function(file){
    if(!file.type || !file.type.startsWith('image/')) return;
    compressImageForNote(file).then(function(img){
      SNOTE_IMGS.push(img);
      snoteRenderImgs();
    }).catch(function(err){
      console.error('Image compression failed:', err);
      toast('Could not add that image');
    });
  });
  var sfi = document.getElementById('snote-file-in'); if(sfi) sfi.value = '';
}
function snoteRenderImgs(){
  var bar = document.getElementById('snote-imgs'); if(!bar)return;
  bar.innerHTML = '';
  SNOTE_IMGS.forEach(function(img,i){
    var w=document.createElement('div'); w.className='snote-img-thumb';
    var im=document.createElement('img'); im.src='data:'+img.mime+';base64,'+img.data;
    var rm=document.createElement('button'); rm.className='snote-img-rm'; rm.textContent='\u00d7';
    rm.onclick=function(e){e.stopPropagation();SNOTE_IMGS.splice(i,1);snoteRenderImgs();};
    w.appendChild(im); w.appendChild(rm); bar.appendChild(w);
  });
}



/* ── IMAGE LIGHTBOX ── */
var LBX_IMGS = [];
var LBX_IDX = 0;

function lbxOpen(imgs, startIdx){
  LBX_IMGS = imgs; LBX_IDX = startIdx || 0;
  lbxRender();
  document.getElementById('img-lightbox').classList.add('open');
  document.addEventListener('keydown', lbxKey);
}
function lbxClose(){
  document.getElementById('img-lightbox').classList.remove('open');
  document.removeEventListener('keydown', lbxKey);
}
function lbxKey(e){
  if(e.key==='Escape') lbxClose();
  else if(e.key==='ArrowLeft') lbxNav(-1);
  else if(e.key==='ArrowRight') lbxNav(1);
}
function lbxNav(dir){
  LBX_IDX = Math.max(0, Math.min(LBX_IMGS.length-1, LBX_IDX+dir));
  lbxRender();
}
function lbxRender(){
  var img = LBX_IMGS[LBX_IDX];
  var el = document.getElementById('lbx-img');
  el.style.opacity='0';
  setTimeout(function(){
    el.src = typeof img === 'string' ? img : 'data:'+img.mime+';base64,'+img.data;
    el.style.opacity='1';
    el.style.transition='opacity .15s';
  }, 80);
  var count = document.getElementById('lbx-count');
  if(count) count.textContent = LBX_IMGS.length > 1 ? (LBX_IDX+1) + ' / ' + LBX_IMGS.length : '';
  var prev=document.getElementById('lbx-prev'), next=document.getElementById('lbx-next');
  if(prev) prev.className='lbx-nav'+(LBX_IDX===0?' hidden':'');
  if(next) next.className='lbx-nav'+(LBX_IDX===LBX_IMGS.length-1?' hidden':'');
  /* Dots */
  var dots=document.getElementById('lbx-dots'); if(!dots)return;
  dots.innerHTML='';
  if(LBX_IMGS.length>1){
    LBX_IMGS.forEach(function(_,i){
      var d=document.createElement('div');
      d.className='lbx-dot'+(i===LBX_IDX?' active':'');
      d.onclick=function(e){e.stopPropagation();LBX_IDX=i;lbxRender();};
      dots.appendChild(d);
    });
  }
}

/* ── SUBJECT COMBOBOX ── */
var NED_SUBJ_FOCUS = false;
function nedSubjOpen(){
  NED_SUBJ_FOCUS=true;
  nedSubjFilter(document.getElementById('ned-subj').value);
  document.getElementById('ned-subj-wrap').classList.add('open');
}
function nedSubjClose(){
  NED_SUBJ_FOCUS=false;
  document.getElementById('ned-subj-wrap').classList.remove('open');
  var drop=document.getElementById('ned-subj-drop');
  if(drop) drop.classList.remove('open');
}
function nedSubjFilter(val){
  var drop=document.getElementById('ned-subj-drop'); if(!drop)return;
  var subjects=D&&D.subj?D.subj:[];
  var filtered=val.trim()
    ? subjects.filter(function(s){return s.toLowerCase().indexOf(val.toLowerCase())>=0;})
    : subjects;
  drop.innerHTML='';
  if(filtered.length===0){
    var none=document.createElement('div');
    none.className='ned-subj-opt no-match';
    none.textContent=val.trim()?'Press Enter to use "'+val.trim()+'"':'No saved subjects yet';
    drop.appendChild(none);
  } else {
    filtered.forEach(function(s){
      var opt=document.createElement('div'); opt.className='ned-subj-opt';
      opt.textContent=s;
      opt.onmousedown=function(e){
        e.preventDefault();
        document.getElementById('ned-subj').value=s;
        nedSubjClose();
      };
      drop.appendChild(opt);
    });
  }
  drop.classList.add('open');
}
function nedSubjKey(e){
  if(e.key==='Escape'){ nedSubjClose(); }
  else if(e.key==='Enter'){
    e.preventDefault();
    var first=document.querySelector('#ned-subj-drop .ned-subj-opt:not(.no-match)');
    if(first) first.onmousedown({preventDefault:function(){}});
    else nedSubjClose();
  }
}

/* ── PAUSE COUNTDOWN ── */
var PAUSE_START_TS = 0;
var PAUSE_CD_TMR = null;

function startPauseCountdown(){
  PAUSE_START_TS = Date.now();
  clearInterval(PAUSE_CD_TMR);
  PAUSE_CD_TMR = setInterval(function(){
    var sec = Math.floor((Date.now() - PAUSE_START_TS) / 1000);
    var m = Math.floor(sec / 60), s = sec % 60;
    var st = document.getElementById('s-status');
    if(st){
      st.style.color = 'var(--warn)';
      st.textContent = 'Paused · ' + m + ':' + (s < 10 ? '0' : '') + s;
    }
  }, 1000);
  /* Fire immediately */
  var st = document.getElementById('s-status');
  if(st){ st.style.color='var(--warn)'; st.textContent='Paused · 0:00'; }
}

function stopPauseCountdown(){
  clearInterval(PAUSE_CD_TMR);
  PAUSE_CD_TMR = null;
  var st = document.getElementById('s-status');
  if(st){ st.style.color=''; st.textContent='In Progress'; }
}


focoInitSession();
loadNotes();
wirePasteImageSupport();
init();
