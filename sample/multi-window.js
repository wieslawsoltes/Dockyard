import * as A from '../src/index.js';
const $ = id => document.getElementById(id);
function editor(id, title) {
  const root = document.createElement('article'); root.className = 'editor';
  const h = document.createElement('h2'); h.textContent = title;
  const p = document.createElement('p'); p.textContent = 'Type here, move this tab to another window, and dock it back. It is the same DOM node, not a screenshot or a cloned document.';
  const input = document.createElement('textarea'); input.setAttribute('aria-label', `${title} text`);
  input.value = `// ${title}\n// Edit me in either hosting mode.\n\nconst floating = manager.FloatInBrowserWindow(documentModel);\nmanager.FloatInPage(floating);\nmanager.Dock(floating);\n`;
  root.append(h,p,input);
  const item = new A.LayoutDocument({ContentId:id,Title:title,Content:root});
  input.addEventListener('input',()=>{const live=manager.Find(id);if(live)live.IsModified=true;});
  return item;
}
const first=editor('editor-a','Workspace.js'),second=editor('editor-b','Settings.js');
const documents=new A.LayoutDocumentPane({Children:[first,second]});
const events=document.createElement('pre');events.id='events';events.className='tool-content';
const inspector=document.createElement('div');inspector.className='tool-content';inspector.textContent='Live content: the counter and listeners stay attached in both window modes.';
const count=document.createElement('button');count.textContent='Counter: 0';let clicks=0;count.onclick=()=>count.textContent=`Counter: ${++clicks}`;inspector.append(count);
const tools=new A.LayoutAnchorablePaneGroup({Orientation:'Vertical',DockWidth:280,Children:[
  new A.LayoutAnchorablePane({Children:[new A.LayoutAnchorable({ContentId:'inspector',Title:'Inspector',Content:inspector})]}),
  new A.LayoutAnchorablePane({Children:[new A.LayoutAnchorable({ContentId:'events',Title:'Window events',Content:events})]})
]});
const manager=new A.DockingManager($('workspace'),{Layout:new A.LayoutRoot(new A.LayoutPanel({Children:[documents,tools]})),AllowMixedOrientation:true});
const rows=[];
function status(message){$('status').textContent=message||`${manager.BrowserWindows.length} browser windows · ${manager.Layout.FloatingWindows.Count-manager.BrowserWindows.length} in-page windows · ${manager.PendingBrowserWindows.length} pending`;}
for(const name of ['BrowserWindowOpened','BrowserWindowClosed','BrowserWindowBlocked','ContentHostChanged']) manager[name].add((_s,e)=>{
  rows.push(`${name}: ${e.Model?.Title||e.Model?.Id||''}${e.Reason?` (${e.Reason})`:''}`);events.textContent=rows.slice(-18).join('\n');status();
});
manager.LayoutUpdated.add(()=>status());manager.Error.add((_s,e)=>status(e.Error.message));
$('mode').onchange=e=>manager.FloatingWindowMode=e.target.value;
$('close').onchange=e=>manager.BrowserWindowCloseBehavior=e.target.value;
$('theme').onchange=e=>manager.Theme=e.target.value;
$('native').onclick=()=>manager.FloatInBrowserWindow(manager.Find('editor-a')||manager.AddDocument(editor('editor-a','Workspace.js')));
$('inpage').onclick=()=>manager.FloatInPage(manager.Find('editor-a'));
$('group').onclick=()=>{
  const item=manager.Find('inspector');if(item?.IsHidden)item.Show();
  const window=item?.FindParent(A.LayoutFloatingWindow);
  manager.FloatInBrowserWindow(window || item?.FindParent(A.LayoutAnchorablePaneGroup) || item);
};
$('dockback').onclick=()=>{for(const f of [...manager.Layout.FloatingWindows])manager.Dock(f);};
let saved=null;
$('save').onclick=()=>{saved=manager.SaveLayout('json');try{localStorage.setItem('dockyard.multi-window',saved);status('Saved on this device');}catch{status('Saved in memory; storage unavailable');}};
$('load').onclick=()=>{try{saved=localStorage.getItem('dockyard.multi-window')||saved;}catch{}if(saved)manager.LoadLayout(saved);else status('Save a layout first');};
$('resume').onclick=()=>{manager.RestoreBrowserWindows();status();};
// Exposes the actual API for interactive exploration; no independent child runtime.
window.multiWindowDemo={manager,A,first,second};status();
