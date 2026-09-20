import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../src/index.js';
function setup(t, options={}) {
  const m=new A.DockingManager(options);
  const a=m.AddDocument({ContentId:'a'}), b=m.AddDocument({ContentId:'b'});
  t.after(()=>m.Dispose()); return {m,a,b};
}
test('floating host defaults preserve the in-page API',t=>{
  const {m,a}=setup(t); assert.equal(m.FloatingWindowMode,A.FloatingWindowMode.InPage);
  assert.equal(a.Float().FloatingWindowMode,'InPage'); assert.equal(m.BrowserWindows.length,0);
  assert.equal(a.Dock(),true); A.validateLayout(m.Layout);
});
test('default mode, per-content override and per-operation override have defined precedence',t=>{
  const {m,a,b}=setup(t,{FloatingWindowMode:'BrowserWindow'});
  b.FloatingWindowMode='InPage'; assert.equal(b.Float().FloatingWindowMode,'InPage');
  assert.equal(a.Float().FloatingWindowMode,'BrowserWindow');
  assert.equal(m.PendingBrowserWindows.length,1);
  const f=m.FloatInPage(a); assert.equal(f.FloatingWindowMode,'InPage');
  assert.equal(m.Layout.FloatingWindows.Count,2); // no duplicate on host change
  assert.equal(m.FloatInBrowserWindow(b).FloatingWindowMode,'BrowserWindow');
});
test('invalid modes and bounds reject before changing layout',t=>{
  const {m,a}=setup(t); const before=m.SaveLayout();
  for(const bounds of [{FloatingWindowMode:'Other'},{FloatingLeft:Infinity},{FloatingWidth:-20},{BrowserWindowFallback:'Ignore'}]) assert.throws(()=>m.Float(a,bounds));
  assert.equal(m.SaveLayout(),before);
  assert.throws(()=>m.FloatingWindowMode='Other'); assert.throws(()=>a.FloatingWindowMode='Other');
});
test('host intent survives JSON, XML, undo, and redo without opening windows in headless models',t=>{
  const {m,a}=setup(t); const f=m.FloatInBrowserWindow(a,{FloatingLeft:-100,FloatingTop:20,FloatingWidth:700});
  const id=f.Id;
  for(const format of ['json','xml']) {
    const data=m.SaveLayout(format); m.LoadLayout(data);
    assert.equal(m.FindById(id).FloatingWindowMode,'BrowserWindow');
    assert.equal(m.FindById(id).FloatingLeft,-100);
    assert.equal(m.PendingBrowserWindows.length,1);
  }
  m.FloatInPage(m.FindById(id));m.Undo();assert.equal(m.FindById(id).FloatingWindowMode,'BrowserWindow');
  m.Redo();assert.equal(m.FindById(id).FloatingWindowMode,'InPage');A.validateLayout(m.Layout);
});
test('floating document panes preserves group contents and original dock-back indices',t=>{
  const {m,a,b}=setup(t);const pane=a.Parent;
  const f=m.FloatInBrowserWindow(pane);assert.ok(f instanceof A.LayoutDocumentFloatingWindow);
  assert.equal(A.contents(f).length,2);assert.notEqual(f.RootPanel,pane);
  m.Dock(f);assert.equal(a.Parent,pane);assert.equal(b.Parent,pane);assert.deepEqual([...pane.Children],[a,b]);A.validateLayout(m.Layout);
});
test('nested document pane groups float as one typed window',t=>{
  const {m,a,b}=setup(t);m.NewTabGroup(b,'Vertical');
  const group=new A.LayoutDocumentPaneGroup({Children:[a.Parent,b.Parent]});m.Layout.RootPanel.Children.Add(group);
  const f=m.FloatInBrowserWindow(group);assert.ok(f.RootPanel instanceof A.LayoutDocumentPaneGroup);assert.equal(f.RootPanel.ChildrenCount,2);
  m.Dock(f);assert.equal(m.Layout.FloatingWindows.Count,0);A.validateLayout(m.Layout);
});
test('capabilities gate both hosting modes and commands',t=>{
  const {m,a}=setup(t);a.CanFloat=false;
  assert.equal(m.FloatInBrowserWindow(a),false);assert.equal(m.FloatInPage(a),false);
  assert.equal(m.GetLayoutItemFromModel(a).FloatInBrowserWindowCommand.CanExecute(),false);
  a.CanFloat=true;m.AllowBrowserWindows=false;m.BrowserWindowFallback='Cancel';
  assert.equal(m.FloatInBrowserWindow(a),false);assert.equal(m.GetLayoutItemFromModel(a).FloatInBrowserWindowCommand.CanExecute(),false);
  m.BrowserWindowFallback='InPage';assert.equal(m.FloatInBrowserWindow(a).FloatingWindowMode,'InPage');
});
test('stale window controls cannot close current content after layout replacement',t=>{
  const {m,a}=setup(t);const old=m.FloatInPage(a);m.LoadLayout(m.SaveLayout());
  assert.equal(m.CloseFloatingWindow(old),false);assert.ok(m.Find('a'));
});
test('AvalonDock floating-control collection events include docking removals',t=>{
  const {m,a}=setup(t);const changes=[],created=[],closed=[];
  m.LayoutFloatingWindowControlCollectionChanged.add((_s,e)=>changes.push(e.CollectionChangedEventArgs));
  m.LayoutFloatingWindowControlCreated.add((_s,e)=>created.push(e.Model));
  m.LayoutFloatingWindowControlClosed.add((_s,e)=>closed.push(e.Model));
  const f=m.FloatInPage(a);m.FloatInBrowserWindow(f);m.Dock(f);
  assert.deepEqual(created,[f]);assert.deepEqual(closed,[f]);
  assert.deepEqual(changes.map(x=>x.Action),['Add','Remove']);
  assert.equal(changes[0].NewItems[0],f);assert.equal(changes[1].OldItems[0],f);
});
test('group close cancellation is atomic for both host modes',t=>{
  const {m,a,b}=setup(t);const f=m.FloatInBrowserWindow(a.Parent);
  b.Closing.add((_s,e)=>{e.Cancel=true;});
  assert.equal(m.CloseFloatingWindow(f),false);assert.equal(A.contents(f).length,2);assert.equal(m.Find('a'),a);assert.equal(m.Find('b'),b);
});
