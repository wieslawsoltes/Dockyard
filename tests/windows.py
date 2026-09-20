"""HTTP-served, real multi-page Chromium tests. No OS/multi-monitor claims.
Cross-document DnD tests dispatch DragEvents on actual browser documents; pointer
resize and menu/keyboard interactions use Playwright's physical input API.
"""
import argparse, functools, http.server, json, os, threading, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
CASES=[]
def case(name):
    def wrap(fn): CASES.append((name,fn));return fn
    return wrap
def ev(p,s):return p.evaluate('(source)=>(0,eval)(source)',s)
def settle(p):p.wait_for_timeout(140)
def open_window(p,key='a'):
    ev(p,f'openSubject({json.dumps(key)})')
    with p.expect_popup() as pending:p.locator('#open').click()
    popup=pending.value;popup.wait_for_selector('.ad-popup-shell');settle(p)
    return popup
def assert_valid(p):assert ev(p,'valid().contents')==5

def native_drop(p,source_id,target_id,position='Center',forged=False):
    # Real child documents, model state and event handlers; controlled DragEvent
    # dispatch, not a claim of dragging through native window-manager chrome.
    return p.evaluate('''({source_id,target_id,position,forged})=>{
      const v=manager._view,s=manager.Find(source_id),t=manager.Find(target_id);
      const from=v.tabs.get(`${s.Parent.Id}:${s.ContentId}`).el;
      const target=v.elementFor(t.Parent),r=target.getBoundingClientRect();
      const sw=from.ownerDocument.defaultView,tw=target.ownerDocument.defaultView;
      const dt=new sw.DataTransfer();
      from.dispatchEvent(new sw.DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
      if(forged)dt.setData('application/x-dockyard-window','forged');
      let x=r.left+r.width/2,y=r.top+r.height/2;
      if(position==='Right')x=r.right-45;if(position==='Bottom')y=r.bottom-45;
      target.dispatchEvent(new tw.DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y}));
      target.dispatchEvent(new tw.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y}));
      from.dispatchEvent(new sw.DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
      return valid();
    }''',dict(source_id=source_id,target_id=target_id,position=position,forged=forged))

@case('Default browser hosting, per-item override, coexistence and native control handle')
def configuration(p):
    ev(p,"manager.FloatingWindowMode='BrowserWindow';manager.Activate(a)")
    with p.expect_popup() as pending:p.locator('#float').click()
    w=pending.value;w.wait_for_selector('.ad-popup-shell');settle(p)
    ev(p,"docB.FloatingWindowMode='InPage';docB.Float()")
    settle(p);assert p.locator('.ad-floating').count()==1
    assert ev(p,"manager.BrowserWindows.length===1 && manager.BrowserWindows[0].Window===manager._view.popups.values().next().value.window")
    assert ev(p,'manager.BrowserWindows[0].Element.ownerDocument===manager.BrowserWindows[0].Window.document')
    assert_valid(p)

@case('Two independent native windows retain original DOM, event listeners and content')
def retained(p):
    w=open_window(p);v=open_window(p,'docB')
    w.get_by_role('textbox',name='Editor A').fill('edits in first window')
    v.get_by_role('textbox',name='Editor B').fill('edits in second window')
    assert ev(p,'counter')==1
    assert ev(p,'editor.ownerDocument!==document && b.ownerDocument!==editor.ownerDocument')
    w.get_by_role('button',name='Dock back into workspace').click();settle(p)
    assert w.is_closed();assert not v.is_closed()
    assert ev(p,"editor.ownerDocument===document && editor.value==='edits in first window'")
    assert ev(p,"b.value==='edits in second window'")
    assert_valid(p)

@case('Host switching is immediate, nondestructive and reuses the floating model')
def switch(p):
    w=open_window(p);id=ev(p,'a.FindParent(A.LayoutFloatingWindow).Id')
    w.get_by_role('textbox',name='Editor A').fill('kept')
    w.get_by_role('button',name='Move to in-page floating window').click();settle(p)
    assert w.is_closed();assert ev(p,'manager.Layout.FloatingWindows.Count')==1
    assert ev(p,'a.FindParent(A.LayoutFloatingWindow).Id')==id
    assert ev(p,"editor.value==='kept' && editor.ownerDocument===document")
    with p.expect_popup() as pending:p.get_by_role('button',name='Open in browser window',exact=True).click()
    pending.value.wait_for_selector('.ad-popup-shell');assert ev(p,'manager.Layout.FloatingWindows.Count')==1
    assert_valid(p)

@case('Native close docks safely; Close behavior honors veto without losing content')
def close(p):
    w=open_window(p);w.get_by_role('textbox',name='Editor A').fill('unsaved');w.close();p.wait_for_timeout(700)
    assert ev(p,"!a.IsFloating && editor.value==='unsaved' && manager.BrowserWindows.length===0")
    ev(p,"manager.BrowserWindowCloseBehavior='Close';a.Closing.add((_s,e)=>e.Cancel=true)")
    w=open_window(p);w.close();p.wait_for_timeout(700)
    assert ev(p,"manager.Find('a')!==null && manager.Find('a').IsFloating && manager.Find('a').FindParent(A.LayoutFloatingWindow).FloatingWindowMode==='InPage'")
    assert ev(p,"editor.value==='unsaved'");assert_valid(p)

@case('UI close can be canceled while the native window remains open')
def canceled(p):
    ev(p,'a.Closing.add((_s,e)=>e.Cancel=true)');w=open_window(p)
    w.get_by_role('button',name='Close floating window',exact=True).click();settle(p)
    assert not w.is_closed();assert ev(p,"manager.Find('a')===a");assert_valid(p)

@case('Popup denial: legacy PopOut cancels, configured fallback and Cancel are atomic')
def blocked(p):
    ev(p,'window.open=()=>null;window.before=manager.SaveLayout();manager.PopOut(a)')
    assert ev(p,'before===manager.SaveLayout() && !a.IsFloating')
    ev(p,"manager.BrowserWindowFallback='Cancel';manager.FloatInBrowserWindow(a)")
    assert ev(p,'before===manager.SaveLayout()')
    ev(p,"manager.BrowserWindowFallback='InPage';manager.FloatInBrowserWindow(a)");settle(p)
    assert ev(p,"a.IsFloating && a.FindParent(A.LayoutFloatingWindow).FloatingWindowMode==='InPage'")
    assert len(ev(p,"events.filter(e=>e.name==='BrowserWindowBlocked')"))==3
    assert_valid(p)

@case('Child-window context menu, keyboard navigation and title/theme updates')
def menu(p):
    w=open_window(p);tab=w.locator('.ad-tab');tab.click(button='right')
    assert w.get_by_role('menu').is_visible();assert p.get_by_role('menu').count()==0
    w.keyboard.press('Escape');assert w.get_by_role('menu').count()==0
    ev(p,"a.Title='Renamed editor';manager.Theme='light';manager.FlowDirection='RightToLeft'");settle(p)
    assert w.title()=='Renamed editor'
    assert w.locator('.ad-popup-shell').get_attribute('data-theme')=='light'
    assert w.locator('.ad-popup-shell').get_attribute('dir')=='rtl'
    w.locator('.ad-tab').focus();w.keyboard.press('Shift+F10');assert w.get_by_role('menu').is_visible()
    w.keyboard.press('Escape');assert_valid(p)

@case('Nested tool groups retain splitters and child-document pointer resizing')
def splitters(p):
    w=open_window(p,'tools');handle=w.locator('.ad-splitter');handle.wait_for(state='visible');r=handle.bounding_box()
    assert r and r['width']>0
    old=ev(p,"toolA.Parent.DockHeight.toString()")
    x,y=r['x']+r['width']/2,r['y']+r['height']/2
    w.mouse.move(x,y);w.mouse.down();w.mouse.move(x,y+40,steps=8);w.mouse.up();settle(p)
    assert ev(p,"toolA.Parent.DockHeight.toString()")!=old
    assert ev(p,"!manager._view.interaction && !manager._view.popups.values().next().value.doc.documentElement.classList.contains('ad-is-interacting')")
    assert_valid(p)

@case('Native drag-and-drop moves tabs from owner to child, between children and back')
def cross_drag(p):
    w=open_window(p);v=open_window(p,'docB')
    native_drop(p,'c','a');settle(p)
    assert ev(p,'docC.Parent===a.Parent && docC.IsFloating')
    native_drop(p,'c','b');settle(p)
    assert ev(p,'docC.Parent===docB.Parent && docC.Parent!==a.Parent')
    ev(p,"manager.AddDocument({ContentId:'target',Title:'Target'})");settle(p)
    native_drop(p,'c','target');settle(p)
    assert ev(p,"docC.Parent===manager.Find('target').Parent && !docC.IsFloating")
    assert ev(p,'valid().contents')==6

@case('Cross-window drop validates session token, capabilities and split placement')
def gated_drag(p):
    w=open_window(p);native_drop(p,'b','a',forged=True);settle(p)
    assert ev(p,'!docB.IsFloating')
    ev(p,'docB.CanDock=false');native_drop(p,'b','a');settle(p);assert ev(p,'!docB.IsFloating')
    ev(p,'docB.CanDock=true');native_drop(p,'b','a','Right');settle(p)
    assert ev(p,'docB.IsFloating && docB.Parent!==a.Parent && docB.FindParent(A.LayoutFloatingWindow)===a.FindParent(A.LayoutFloatingWindow)')
    assert w.locator('.ad-pane').count()==2;assert_valid(p)

@case('Native drag reorder inside a child uses browser mouse input')
def native_reorder(p):
    ev(p,'window.fixtures.pane=docs');w=open_window(p,'pane')
    first=w.locator('[data-tab-id="a"]');last=w.locator('[data-tab-id="c"]');r=last.bounding_box()
    first.drag_to(last,target_position={'x':r['width']-3,'y':r['height']/2});settle(p)
    assert ev(p,"a.Parent.Children[2]===a")
    assert_valid(p)

@case('Snapshot replacement rebinds open native windows and dock actions to live models')
def reload(p):
    w=open_window(p);w.get_by_role('textbox',name='Editor A').fill('retained reload')
    ev(p,'manager.LoadLayout(manager.SaveLayout());window.a=manager.Find("a")');settle(p)
    assert not w.is_closed();assert w.get_by_role('textbox',name='Editor A').input_value()=='retained reload'
    w.get_by_role('button',name='Dock back into workspace').click();settle(p)
    assert w.is_closed();assert ev(p,"!manager.Find('a').IsFloating && editor.ownerDocument===document")
    assert_valid(p)

@case('Undo/redo parks browser intent safely; explicit resume restores a pending window')
def history(p):
    ev(p,'manager.ClearHistory()');w=open_window(p)
    ev(p,'manager.Undo()');settle(p)
    assert w.is_closed();assert ev(p,"!manager.Find('a').IsFloating")
    ev(p,'manager.Redo()');settle(p)
    assert ev(p,'manager.PendingBrowserWindows.length===1 && manager.BrowserWindows.length===0')
    ev(p,"document.getElementById('open').onclick=()=>manager.RestoreBrowserWindows()")
    with p.expect_popup() as pending:p.locator('#open').click()
    pending.value.wait_for_selector('.ad-popup-shell');assert ev(p,'manager.PendingBrowserWindows.length')==0
    assert_valid(p)

@case('Native resize tracks AvalonDock geometry and serialized screen coordinates')
def geometry(p):
    w=open_window(p)
    ev(p,"window.f=a.FindParent(A.LayoutFloatingWindow);manager.Transaction('bounds',()=>{f.FloatingWidth=570;f.FloatingHeight=380;f.FloatingLeft=90;f.FloatingTop=100;})")
    p.wait_for_timeout(900)
    assert ev(p,"Math.abs(f.FloatingWidth-manager.BrowserWindows[0].Window.innerWidth)<2 && Math.abs(f.FloatingHeight-manager.BrowserWindows[0].Window.innerHeight)<2")
    assert ev(p,"f.FloatingWidth===570 && f.FloatingHeight===380"),ev(p,"[f.FloatingWidth,f.FloatingHeight]")
    assert ev(p,"JSON.parse(manager.SaveLayout()).layout.floatingWindows[0].props.FloatingWindowMode==='BrowserWindow'")
    assert_valid(p)

@case('Stylesheet changes propagate; manager disable and dispose leave no orphan windows')
def cleanup(p):
    w=open_window(p);v=open_window(p,'docB')
    ev(p,"window.dynamicStyle=document.createElement('style');dynamicStyle.textContent='.ad-popup-toolbar{border-top:7px solid red}';document.head.append(dynamicStyle)");settle(p)
    assert w.locator('.ad-popup-toolbar').evaluate("e=>getComputedStyle(e).borderTopWidth")=='7px'
    ev(p,'manager.AllowBrowserWindows=false');settle(p)
    assert w.is_closed() and v.is_closed();assert ev(p,'manager._view.popups.size')==0
    ev(p,'manager.AllowBrowserWindows=true;window.a=manager.Find("a")');w=open_window(p)
    ev(p,'manager.Dispose()');settle(p);assert w.is_closed()

@case('Child navigation recovers content; owner navigation closes owned windows')
def navigation(p):
    w=open_window(p);w.goto('about:blank');p.wait_for_timeout(650)
    assert ev(p,"manager.Find('a') && !manager.Find('a').IsFloating")
    w=open_window(p);p.goto('about:blank');p.wait_for_timeout(300)
    assert w.is_closed()

@case('Restored browser intent renders in-page without unsolicited popups')
def restore(p):
    w=open_window(p)
    ev(p,'localStorage.setItem("layout",manager.SaveLayout())')
    p.reload();p.wait_for_selector('#host .ad-pane')
    ev(p,'manager.LoadLayout(localStorage.getItem("layout"))');settle(p)
    assert w.is_closed();assert ev(p,'manager.BrowserWindows.length===0 && manager.PendingBrowserWindows.length===1')
    assert p.locator('.ad-browser-pending').count()==1
    assert_valid(p)

@case('Declarative mode options and live attributes configure the custom element')
def component(p):
    ev(p,"window.component=document.createElement('avalon-dock');component.style.height='400px';component.setAttribute('floating-window-mode','BrowserWindow');component.setAttribute('browser-window-close-behavior','InPage');document.body.append(component)");settle(p)
    assert ev(p,"component.manager.FloatingWindowMode==='BrowserWindow' && component.manager.BrowserWindowCloseBehavior==='InPage'")
    ev(p,"component.setAttribute('floating-window-mode','InPage');component.setAttribute('allow-browser-windows','false')")
    assert ev(p,"component.manager.FloatingWindowMode==='InPage' && !component.manager.AllowBrowserWindows")

@case('Content host notifications fire in each direction and controls retain identity')
def host_notifications(p):
    ev(p,"window.moves=[];manager.ContentHostChanged.add((_s,e)=>{moves.push([e.Model?.ContentId,e.Document===document])})")
    w=open_window(p);ev(p,'window.control=manager.BrowserWindows[0]')
    assert ev(p,'control===manager.BrowserWindows[0]')
    assert ev(p,"moves.some(x=>x[0]==='a' && x[1]===false)")
    w.get_by_role('button',name='Dock back into workspace').click();settle(p)
    assert ev(p,"moves.some(x=>x[0]==='a' && x[1]===true)")
    assert ev(p,'!control.IsBrowserWindow');assert_valid(p)

@case('Visible child schedules layout work while owner visibility is hidden')
def hidden_owner(p):
    w=open_window(p)
    ev(p,"Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'));a.Title='Owner hidden'")
    p.wait_for_timeout(250)
    assert w.title()=='Owner hidden'
    assert ev(p,"manager._view.frameWindow===manager.BrowserWindows[0].Window")
    assert_valid(p)

@case('Maximize and restore expose actual browser-window dimensions without losing content')
def maximize(p):
    w=open_window(p);p.wait_for_timeout(700)
    ev(p,'window.control=manager.BrowserWindows[0];window.startWidth=control.Window.innerWidth;control.Maximize()')
    p.wait_for_timeout(800);assert ev(p,'control.IsMaximized')
    ev(p,'control.Restore()');p.wait_for_timeout(800)
    assert ev(p,'!control.IsMaximized && Math.abs(control.Window.innerWidth-startWidth)<3')
    assert_valid(p)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--offline',action='store_true',help='Inline fixture in about:blank; excludes genuine HTTP reload/storage test')
parser.add_argument('--case',default='',help='Run cases containing this substring')
args=parser.parse_args()
html=(ROOT/'tests/windows.html').read_text().replace('<link rel="stylesheet" href="../dist/avalondock.css">', '<style>'+ (ROOT/'dist/avalondock.css').read_text()+'</style>').replace('<script src="../dist/avalondock.js"></script>', '<script>'+(ROOT/'dist/avalondock.js').read_text()+'</script>')
results=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or '/usr/bin/chromium',headless=True,args=['--no-sandbox','--window-size=1200,800'])
    version=browser.version
    for name,fn in CASES:
        if args.case and args.case.lower() not in name.lower():continue
        if args.offline and fn is restore:continue
        context=browser.new_context(no_viewport=True);page=context.new_page();page.set_default_timeout(10000);errors=[]
        context.on('page',lambda child: child.on('pageerror',lambda err: errors.append(str(err))))
        page.on('pageerror',lambda err:errors.append(str(err)))
        try:
            if args.offline:page.set_content(html)
            else:page.goto(f'http://127.0.0.1:{server.server_port}/tests/windows.html')
            page.wait_for_selector('#host .ad-pane')
            fn(page)
            assert not errors,errors
            results.append({'name':name,'passed':True});print('PASS',name,flush=True)
        except Exception as error:
            results.append({'name':name,'passed':False,'error':str(error),'trace':traceback.format_exc(),'pageErrors':errors})
            print('FAIL',name,traceback.format_exc(),errors,flush=True)
        finally:context.close()
    browser.close()
server.shutdown()
report={'browser':version,'mode':('Offline about:blank fixture' if args.offline else 'Real HTTP-origin fixture')+'; real Chromium windows; mouse/keyboard interaction; cross-document DragEvent dispatch', 'passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results),'tests':results}
(ROOT/'test-results').mkdir(exist_ok=True);(ROOT/'test-results/windows-results.json').write_text(json.dumps(report,indent=2)+'\n')
print(f"{report['passed']}/{len(results)} browser-window groups passed",flush=True)
raise SystemExit(bool(report['failed']))
