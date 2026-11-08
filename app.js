const PKEY='tesla_drive_tv';

const STORAGE={
  last:()=>JSON.parse(localStorage.getItem(PKEY+'_last')||'[]'),
  lastSave:arr=>localStorage.setItem(PKEY+'_last',JSON.stringify(arr)),
  current:()=>localStorage.getItem(PKEY+'_cur'),
  currentSave:id=>localStorage.setItem(PKEY+'_cur',id)
};

let currentId=null;
let lastState=null;
let lastStateTime=0;
let driveMode=false;
let seekInterval=null;
let toastTimer=null;
let iframeEl=null;
let videoDuration=0;
let playlist=[];
let plIndex=-1;

function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),3000);
}
function formatTime(s){
  s=Math.floor(s);
  const m=Math.floor(s/60),sec=s%60;
  if(m<1) return sec+'s';
  return m+':'+(sec<10?'0':'')+sec;
}

function parseId(input){
  const s=input.trim();
  const patterns=[
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /\/embed\/([A-Za-z0-9_-]{11})/,
    /\/shorts\/([A-Za-z0-9_-]{11})/,
    /\/v\/([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/
  ];
  for(const p of patterns){
    const m=s.match(p);
    if(m) return m[1];
  }
  return null;
}

function loadVideo(id){
  currentId=id;
  const last=STORAGE.last();
  const idx=last.findIndex(v=>v.id===id);
  if(idx>=0) last.splice(idx,1);
  last.unshift({id:id,time:Date.now()});
  if(last.length>50) last.length=50;
  STORAGE.lastSave(last);
  STORAGE.currentSave(id);
  document.getElementById('vidTitle').textContent='YouTube — '+id;
  renderLast();

  // Basit iframe embed — IFrame API olmadan doğrudan YouTube embed
  const embedUrl='https://www.youtube-nocookie.com/embed/'+id+'?autoplay=1&rel=0&playsinline=1&modestbranding=1&controls=1&enablejsapi=1';
  const playerArea=document.getElementById('ytplayer');
  playerArea.innerHTML='<iframe id="ytplayer" src="'+embedUrl+'" width="100%" height="100%" style="border:none;display:block;" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
  iframeEl=document.getElementById('ytplayer');
  videoDuration=0;
}

function handleInput(){
  const val=document.getElementById('urlIn').value.trim();
  if(!val) return;
  const id=parseId(val);
  if(id){
    loadVideo(id);
    document.getElementById('urlIn').value='';
    showToast('Oynatılıyor...');
  } else {
    window.location.href='https://www.youtube.com/results?search_query='+encodeURIComponent(val);
  }
}

document.getElementById('prevBtn').onclick=()=>{
  if(playlist.length&&plIndex>0){ plIndex--; loadVideo(playlist[plIndex]); }
};
document.getElementById('nextBtn').onclick=()=>{
  if(playlist.length&&plIndex<playlist.length-1){ plIndex++; loadVideo(playlist[plIndex]); }
};

document.getElementById('muteBtn').onclick=()=>{
  if(!iframeEl) return;
  const src=iframeEl.src;
  if(src.indexOf('mute=0')>-1||!src.match(/mute=[01]/)){
    iframeEl.src=src.replace('autoplay=1','autoplay=1&mute=1');
    document.getElementById('muteBtn').textContent='🔇';
  } else {
    iframeEl.src=src.replace('mute=1','mute=0');
    document.getElementById('muteBtn').textContent='🔊';
  }
};

document.getElementById('qualityBtn').onclick=()=>{
  const qs=['720','1080','480','360'];
  const cur=qs.indexOf(document.getElementById('qualityBtn').textContent.replace('p',''));
  const next=qs[(cur+1)%qs.length];
  document.getElementById('qualityBtn').textContent=next+'p';
  if(iframeEl&&currentId) loadVideo(currentId);
};

document.getElementById('seekBar').addEventListener('input',()=>{
  if(!iframeEl) return;
  try{
    const p=parseFloat(document.getElementById('seekBar').value)/100;
    iframeEl.contentWindow.postMessage('{"event":"command","func":"seekTo","args":["'+p*videoDuration+'","true"]}','*');
  }catch(e){}
});

// Drive mode: polling to detect if video paused
let pollTimer=null;
function startPolling(){
  stopPolling();
  pollTimer=setInterval(()=>{
    if(!iframeEl||!iframeEl.contentWindow) return;
    try{
      iframeEl.contentWindow.postMessage('{"event":"command","func":"getPlayerState","args":[]}','*');
    }catch(e){}
  },2000);
}
function stopPolling(){
  if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
}

// Listen for postMessage from YouTube iframe
window.addEventListener('message',(e)=>{
  if(e.origin!=='https://www.youtube-nocookie.com'&&e.origin!=='https://www.youtube.com') return;
  try{
    const data=JSON.parse(e.data);
    if(data.event==='onStateChange'){
      const states={0:'ENDED',1:'PLAYING',2:'PAUSED',3:'BUFFERING'};
      const st=states[data.arg]||'UNKNOWN';
      const now=Date.now();
      if(st==='PLAYING'){
        lastState='PLAYING'; lastStateTime=now;
        if(driveMode){
          driveMode=false;
          document.getElementById('dot').className='dot';
          document.getElementById('driveBadge').classList.remove('show');
          document.getElementById('statusText').textContent='Park — video oynuyor';
          stopAutoSeek();
          showToast('⏸️ Sürüş modu sona erdi');
        }
      } else if(st==='PAUSED'){
        if(lastState!=='PAUSED'){ lastState='PAUSED'; lastStateTime=now; }
        if(now-lastStateTime>3000&&!driveMode){ enterDriveMode(); }
      }
    }
    if(data.event==='onDurationChange'){
      videoDuration=data.arg||0;
      const seekBar=document.getElementById('seekBar');
      seekBar.max=videoDuration;
      updateSeekBarDisplay();
    }
    if(data.event==='onReady'){
      // Player ready
    }
  }catch(ex){}
});

function enterDriveMode(){
  driveMode=true;
  document.getElementById('dot').className='dot drive';
  document.getElementById('driveBadge').classList.add('show');
  document.getElementById('statusText').textContent='Sürüş modu — ses devam ediyor';
  showToast('🚗 SÜRÜŞ MODU AKTİF — ses devam, video otomatik ileri sarılıyor');
  startAutoSeek();
}

function startAutoSeek(){
  stopAutoSeek();
  seekInterval=setInterval(()=>{
    if(!iframeEl||!videoDuration) return;
    // Seek forward 1s every 800ms to keep video alive
    const seekBar=document.getElementById('seekBar');
    if(seekBar){
      const cur=parseFloat(seekBar.value||0);
      seekBar.value=Math.min(100,cur+0.125);
      updateSeekBarDisplay();
    }
  },800);
}
function stopAutoSeek(){
  if(seekInterval){clearInterval(seekInterval);seekInterval=null;}
}

function updateSeekBarDisplay(){
  if(!videoDuration) return;
  const seekBar=document.getElementById('seekBar');
  const cur=Math.floor((parseFloat(seekBar.value||0)/100)*videoDuration);
  document.getElementById('curTime').textContent=formatTime(cur);
  document.getElementById('durTime').textContent=formatTime(videoDuration);
}

// Last played
function renderLast(){
  const el=document.getElementById('lastList'); el.innerHTML='';
  STORAGE.last().slice(0,8).forEach(v=>{
    const a=document.createElement('a'); a.href='#'; a.textContent=v.id;
    a.onclick=e=>{ e.preventDefault(); loadVideo(v.id); };
    el.appendChild(a);
  });
}

document.getElementById('favBtn').onclick=()=>{
  const v=document.getElementById('favIn').value.trim();
  if(!v) return;
  const id=parseId(v);
  if(!id){ showToast('Geçersiz YouTube linki'); return; }
  const favs=JSON.parse(localStorage.getItem(PKEY+'_favs')||'[]');
  if(favs.find(f=>f.id===id)){ showToast('Zaten ekli'); return; }
  favs.unshift({id:id,time:Date.now()});
  localStorage.setItem(PKEY+'_favs',JSON.stringify(favs));
  document.getElementById('favIn').value='';
  showToast('Favorilere eklendi: '+id);
};

document.getElementById('playBtn').onclick=handleInput;
document.getElementById('urlIn').addEventListener('keydown',e=>{
  if(e.key==='Enter') handleInput();
});

window.addEventListener('load',()=>{
  const cur=STORAGE.current();
  if(cur){
    document.getElementById('urlIn').placeholder='Devam: '+cur+' (otomatik yüklendi)';
    loadVideo(cur);
  }
  renderLast();
});
