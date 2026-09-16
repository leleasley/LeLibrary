(function(){
'use strict';
const root=document.getElementById('instantSetup');if(!root)return;
const byId=id=>document.getElementById(id),moved=[];
// Each pair is one film and one series so the showcase always reflects both.
const posterPairs=[
 [{id:550,title:'Fight Club',type:'movie'},{id:1396,title:'Breaking Bad',type:'series'}],
 [{id:27205,title:'Inception',type:'movie'},{id:66732,title:'Stranger Things',type:'series'}],
 [{id:155,title:'The Dark Knight',type:'movie'},{id:1399,title:'Game of Thrones',type:'series'}],
 [{id:438631,title:'Dune',type:'movie'},{id:100088,title:'The Last of Us',type:'series'}],
 [{id:603,title:'The Matrix',type:'movie'},{id:95396,title:'Severance',type:'series'}],
];
let busy=false,posterTimer=0,posterRotation=0,posterPair=Math.floor(Date.now()/9000)%posterPairs.length,posterVisible=true,posterCards=new Map(),activeFrame=null;
function move(el,target){if(!el)return;const marker=document.createComment('quick setup position');el.before(marker);moved.push({el,marker});byId(target).append(el);}
function resetResult(){byId('instantCopy').textContent='Copy link';byId('instantResult').hidden=true;root.querySelector('.instant-grid').hidden=false;root.querySelector('.instant-heading').hidden=false;byId('instantManifest').value='';byId('instantOpen').removeAttribute('href');}
function stopPosterRotation(){clearTimeout(posterRotation);posterRotation=0;}
function canRotatePosters(){return !root.hidden&&!root.querySelector('.instant-grid').hidden&&posterVisible&&!document.hidden&&byId('instantPictorium').checked;}
function schedulePosterRotation(){stopPosterRotation();if(!canRotatePosters())return;posterRotation=setTimeout(()=>showPosterPair((posterPair+1)%posterPairs.length),9000);}
function posterLabel(sample){return sample.title+(sample.type==='series'?' (series)':' (film)');}
function pairSettled(entry){return entry.imgs.every(img=>img.dataset.loaded);}
function buildPosterFrame(index){
 const preview=byId('instantPictoriumPreview'),token=preview.dataset.token||'',query=preview.dataset.query||'',samples=posterPairs[index];
 const frame=document.createElement('div');frame.className='instant-poster-frame';
 const entry={frame,imgs:[],onSettle:null,settleTimer:0};
 const done=()=>{if(entry.onSettle&&pairSettled(entry)){clearTimeout(entry.settleTimer);const cb=entry.onSettle;entry.onSettle=null;cb();}};
 entry.settleTimer=setTimeout(()=>{if(!entry.onSettle)return;entry.imgs.forEach(img=>{if(!img.dataset.loaded){img.dataset.loaded='false';img.hidden=true;}});clearTimeout(entry.settleTimer);const cb=entry.onSettle;entry.onSettle=null;cb();},40000);
 entry.imgs=samples.map((sample,slot)=>{const img=document.createElement('img');img.className=slot?'instant-poster-right':'instant-poster-left';img.alt='Live Pictorium poster example for '+sample.title;img.onload=()=>{img.dataset.loaded='true';done();};img.onerror=()=>{img.dataset.loaded='false';img.hidden=true;done();};img.src='/'+encodeURIComponent(token)+'/pictorium/'+sample.type+'/'+sample.id+'.jpg?preview=1&title='+encodeURIComponent(sample.title)+(query?'&'+query:'');frame.append(img);return img;});
 posterCards.set(index,entry);return entry;
}
function ensurePosterFrame(index){if(!posterCards.has(index))buildPosterFrame(index);}
function revealPosterFrame(index){
 const entry=posterCards.get(index);if(!entry)return;
 const preview=byId('instantPictoriumPreview'),empty=root.querySelector('.instant-poster-empty'),samples=posterPairs[index];
 if(activeFrame===entry.frame){schedulePosterRotation();return;}
 if(!entry.frame.isConnected)preview.append(entry.frame);
 const previous=activeFrame;activeFrame=entry.frame;
 requestAnimationFrame(()=>entry.frame.classList.add('is-active'));
 if(previous){previous.classList.remove('is-active');setTimeout(()=>{if(previous!==activeFrame&&previous.isConnected)previous.remove();},650);}
 const shown=entry.imgs.filter(img=>img.dataset.loaded==='true').length;
 empty.hidden=shown>0;
 byId('instantPosterState').textContent=shown?('Showing '+posterLabel(samples[0])+' and '+posterLabel(samples[1])+' · rendered by Pictorium.'):'Pictorium could not render this pair yet.';
 ensurePosterFrame((index+1)%posterPairs.length);
 schedulePosterRotation();
}
function showPosterPair(index,force){
 if(!force&&!canRotatePosters())return;
 posterPair=index;const entry=posterCards.get(index)||buildPosterFrame(index);
 if(activeFrame===entry.frame){schedulePosterRotation();return;}
 if(pairSettled(entry)){revealPosterFrame(index);return;}
 entry.onSettle=()=>{if(force||(canRotatePosters()&&posterPair===index))revealPosterFrame(index);};
 if(!activeFrame){const empty=root.querySelector('.instant-poster-empty');empty.hidden=false;empty.querySelector('strong').textContent='Loading real posters…';empty.querySelector('small').textContent='Rendered by your Pictorium setup.';byId('instantPosterState').textContent='Loading a new Pictorium pair…';}
}
function refreshInstantPosters(){
 const state=byId('instantPosterState'),empty=root.querySelector('.instant-poster-empty'),preview=byId('instantPictoriumPreview'),selected=byId('instantPictorium').checked;
 stopPosterRotation();posterCards.forEach(entry=>clearTimeout(entry.settleTimer));posterCards.clear();activeFrame=null;preview.querySelectorAll('.instant-poster-frame').forEach(frame=>frame.remove());empty.hidden=false;
 if(!selected){empty.querySelector('strong').textContent='Standard TMDB artwork';empty.querySelector('small').textContent='Turn Pictorium on to see its poster style.';state.textContent='Pictorium posters are switched off.';return;}
 const tmdb=byId('tmdbApiKey').value.trim();
 if(!ACCOUNT_TOKEN&&!tmdb){empty.querySelector('strong').textContent='Add your TMDB key';empty.querySelector('small').textContent='Your live poster examples will appear here.';state.textContent='Add your TMDB key to load real Pictorium examples.';return;}
 byId('posterProvider').value='pictorium';
 const token=pictoriumPreviewToken();
 if(!token){state.textContent='Complete your setup to load the poster preview.';return;}
 const query=window.LePictoriumOptions?window.LePictoriumOptions.toQuery(pictoriumOptions||{}):'';
 preview.dataset.token=token;preview.dataset.query=query;
 empty.querySelector('strong').textContent='Loading real posters…';
 empty.querySelector('small').textContent='Rendered by your Pictorium setup.';
 state.textContent='Loading a new Pictorium pair…';
 showPosterPair(posterPair,true);
}
function queueInstantPosters(){clearTimeout(posterTimer);posterTimer=setTimeout(refreshInstantPosters,450);}
window.openInstantSetup=function(){if(busy)return;document.body.classList.remove('choosing');const ch=byId('setupChooser');if(ch)ch.hidden=true;if(!moved.length){move(byId('platformCards'),'instantPlayer');['tbCard','rdCard','adCard','pmCard'].forEach(id=>move(byId(id),'instantProviders'));move(byId('tmdbApiKey').closest('.field'),'instantMetadata');move(byId('customStreamsCard'),'instantStreams');}document.body.classList.add('instant-active');root.hidden=false;resetResult();const csCard=byId('customStreamsCard');if(csCard){csCard.querySelector('.coll-body')?.classList.add('open');csCard.querySelector('.coll-arrow')?.classList.add('open');}if(typeof renderCustomStreams==='function'){try{renderCustomStreams();}catch{}}refreshInstantPosters();root.scrollIntoView({block:'start'});};
window.chooseSetup=function(mode){const chooser=byId('setupChooser');document.body.classList.remove('choosing');if(chooser&&!chooser.hidden){if(matchMedia('(prefers-reduced-motion: reduce)').matches){chooser.hidden=true;}else{chooser.classList.add('leaving');setTimeout(()=>{chooser.hidden=true;chooser.classList.remove('leaving');},260);}}if(mode==='instant'){openInstantSetup();}else{window.scrollTo(0,0);}};
byId('instantCustom').onclick=function(){if(busy)return;stopPosterRotation();moved.splice(0).forEach(({el,marker})=>marker.replaceWith(el));root.hidden=true;document.body.classList.remove('instant-active');onPosterChange();goToStep(1);};
byId('instantEdit').onclick=function(){resetResult();schedulePosterRotation();};
root.addEventListener('input',()=>{if(!busy)byId('instantFeedback').textContent='';});
byId('tmdbApiKey').addEventListener('input',queueInstantPosters);
byId('instantPictorium').addEventListener('change',refreshInstantPosters);
document.addEventListener('visibilitychange',()=>document.hidden?stopPosterRotation():schedulePosterRotation());
if('IntersectionObserver'in window)new IntersectionObserver(entries=>{posterVisible=entries[0].isIntersecting;posterVisible?schedulePosterRotation():stopPosterRotation();},{threshold:.15}).observe(byId('instantPictoriumPreview'));
['platformStremio','platformNuvio','tbCard','rdCard','adCard','pmCard'].forEach(id=>{const card=byId(id),control=id.startsWith('platform')?card:card.querySelector('.pc-head');control.setAttribute('role','button');control.tabIndex=0;control.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();if(!busy)control.click();}});});
byId('instantGenerate').onclick=async function(){if(busy)return;busy=true;this.disabled=true;byId('instantFields').disabled=true;byId('instantPictorium').disabled=true;byId('instantCustom').disabled=true;this.textContent='Preparing your library…';byId('instantFeedback').textContent='Checking your keys and saving your setup…';resetResult();
try{
 if(!targetPlatform()){byId('instantFeedback').textContent='Choose Stremio or Nuvio first.';return;}
 byId('posterProvider').value=byId('instantPictorium').checked?'pictorium':'';
 catSelection.movies=true;catSelection.series=true;
 byId('manifestUrl').textContent='';
 await generate({waitSave:true,suppressReinstall:true});
 const url=byId('manifestUrl').textContent.trim();
 if(!url){byId('instantFeedback').textContent='Your manifest isn’t ready yet. Check the highlighted fields or the message shown, then try again.';root.querySelector('.invalid')?.focus();return;}
 initialConfig=getCurrentConfig();byId('unsavedBanner').style.display='none';byId('instantManifest').value=url;byId('instantOpen').href=targetPlatform()==='nuvio'?url.replace(/^https?:\/\//,'nuvio://'):url.replace(/^https?:\/\//,'stremio://');
 byId('instantOpen').textContent=targetPlatform()==='nuvio'?'Open in Nuvio ↗':'Open in Stremio ↗';
 stopPosterRotation();root.querySelector('.instant-grid').hidden=true;root.querySelector('.instant-heading').hidden=true;byId('instantResult').hidden=false;byId('instantResult').focus();byId('instantFeedback').textContent='';
}catch(error){byId('instantFeedback').textContent='Could not save your setup. Please try again. Your entries are still here.';}
finally{busy=false;this.disabled=false;byId('instantFields').disabled=false;byId('instantPictorium').disabled=false;byId('instantCustom').disabled=false;this.textContent='Create my manifest ↗';if(byId('instantResult').hidden)root.querySelector('.invalid')?.focus();}
};
byId('instantCopy').onclick=async function(){try{await navigator.clipboard.writeText(byId('instantManifest').value);this.textContent='Copied ✓';}catch{byId('instantManifest').select();this.textContent='Select and copy';}};
window.LeInstantSetup={queuePosters:function(){if(!root.hidden)queueInstantPosters();}};
})();
