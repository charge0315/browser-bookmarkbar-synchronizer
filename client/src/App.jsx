import React, { useEffect, useState } from 'react';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors, 
  DragOverlay
} from '@dnd-kit/core';
import { 
  arrayMove, 
  sortableKeyboardCoordinates 
} from '@dnd-kit/sortable';
import { 
  Save, 
  GitMerge, 
  Type, 
  ListOrdered, 
  RefreshCw,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import { useBookmarks } from './hooks/useBookmarks';
import { BookmarkColumn } from './components/BookmarkColumn';
import './App.css';

function App() {
  const { 
    bookmarks, 
    setBookmarks, 
    syncSettings,
    toggleSyncSetting,
    previewCandidates,
    activeCandidateIndex,
    selectCandidate,
    fetchBookmarks, 
    saveAll, 
    mergeBookmarks, 
    organizeBookmarks, 
    summarizeBookmarks,
    aiOrganizeAll,
    applyPreviewAndSaveAll,
    rollbackAll,
    loadSampleData,
    logs,
    clearLogs,
    loading,
    error
  } = useBookmarks();

  const handleAiOrganize = () => {
    clearLogs();
    aiOrganizeAll();
  };

  const previewState = activeCandidateIndex >= 0 ? previewCandidates[activeCandidateIndex].data : null;
  const setPreviewState = () => {}; // Dummy since we use selectCandidate now

  const [activeId, setActiveId] = useState(null);
  const [showLogs, setShowLogs] = useState(true);

  const targetState = previewState || bookmarks;
  const setTargetState = previewState ? setPreviewState : setBookmarks;

  useEffect(() => {
    if (import.meta.env.VITE_DEMO_MODE === 'true') {
      loadSampleData();
    } else {
      fetchBookmarks();
    }
  }, [fetchBookmarks, loadSampleData]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const findContainer = (id) => {
    for (const key of Object.keys(targetState)) {
      if (targetState[key]?.roots?.bookmark_bar?.children.some(c => c.id === id)) {
        return key;
      }
    }
    return null;
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    const { id: activeId } = active;
    const { id: overId } = over || {};

    const activeContainer = findContainer(activeId);
    const overContainer = overId ? (overId in targetState ? overId : findContainer(overId)) : null;

    if (!activeContainer || !overContainer || activeContainer !== overContainer) {
      // NOTE: Because activeContainer !== overContainer block is here, dragging between different columns actually gets ignored in this implementation.
      // But since we want users to drag across categories, we MUST support cross-container drag.
      if (activeContainer && overContainer && activeContainer !== overContainer) {
        // Cross-container drag logic
        const sourceChildren = [...targetState[activeContainer].roots.bookmark_bar.children];
        const destChildren = [...targetState[overContainer].roots.bookmark_bar.children];
        const activeIndex = sourceChildren.findIndex(c => c.id === activeId);
        
        const [movedItem] = sourceChildren.splice(activeIndex, 1);
        
        let overIndex = destChildren.findIndex(c => c.id === overId);
        if (overIndex === -1) overIndex = destChildren.length;
        
        destChildren.splice(overIndex, 0, movedItem);

        setTargetState(prev => ({
          ...prev,
          [activeContainer]: {
            ...prev[activeContainer],
            roots: { ...prev[activeContainer].roots, bookmark_bar: { children: sourceChildren } }
          },
          [overContainer]: {
            ...prev[overContainer],
            roots: { ...prev[overContainer].roots, bookmark_bar: { children: destChildren } }
          }
        }));
      }
      setActiveId(null);
      return; 
    }

    if (activeId !== overId) {
      const children = targetState[activeContainer].roots.bookmark_bar.children;
      const oldIndex = children.findIndex(c => c.id === activeId);
      const newIndex = children.findIndex(c => c.id === overId);

      const newChildren = arrayMove(children, oldIndex, newIndex);
      setTargetState(prev => ({
        ...prev,
        [activeContainer]: {
          ...prev[activeContainer],
          roots: {
            ...prev[activeContainer].roots,
            bookmark_bar: {
              ...prev[activeContainer].roots.bookmark_bar,
              children: newChildren
            }
          }
        }
      }));
    }

    setActiveId(null);
  };

  return (
    <div className="app-container">
      <header>
        <div className="header-title">
          <h1>Browser Bookmarkbar Synchronizer</h1>
          <p style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
            各ブラウザのブックマークバーをAIで全自動統合・整理します。
          </p>
        </div>
        <div className="controls">
          {!previewState ? (
            <>
              <button 
                className="btn-primary" 
                onClick={handleAiOrganize} 
                disabled={loading}
                style={{ padding: '0.6rem 1.5rem', fontSize: '1.05rem', background: 'linear-gradient(135deg, #a855f7, #3b82f6)' }}
              >
                <RefreshCw size={20} className={loading ? 'spin' : ''} />
                ✨ AI全自動整理
              </button>
              
              <div style={{ width: '1px', background: 'rgba(255,255,255,0.2)', margin: '0 0.5rem' }}></div>
              
              <button className="btn-secondary" onClick={fetchBookmarks} disabled={loading}>
                <RefreshCw size={18} className={loading ? 'spin' : ''} />
                読込
              </button>
              <button className="btn-secondary" onClick={mergeBookmarks} disabled={loading}>
                <GitMerge size={18} />
                手動マージ
              </button>
              <button className="btn-secondary" onClick={rollbackAll} disabled={loading} style={{ color: '#eab308', borderColor: 'rgba(234, 179, 8, 0.5)' }}>
                <RotateCcw size={18} />
                元に戻す(Undo)
              </button>
              <button className="btn-primary" onClick={saveAll} disabled={loading} style={{ background: '#10b981' }}>
                <Save size={18} />
                保存
              </button>
            </>
          ) : (
            <>
              <button 
                className="btn-secondary" 
                onClick={() => window.location.reload()} 
                disabled={loading}
              >
                キャンセル
              </button>
              <button 
                className="btn-primary" 
                onClick={applyPreviewAndSaveAll} 
                disabled={loading}
                style={{ padding: '0.6rem 2rem', fontSize: '1.05rem', background: '#10b981' }}
              >
                <Save size={20} />
                この内容で適用して保存
              </button>
            </>
          )}
        </div>
      </header>

      {previewCandidates.length > 0 && (
        <div className="pattern-selector">
          <h3>AI分類パターンを選択してください:</h3>
          <div className="pattern-cards">
            {previewCandidates.map((p, idx) => (
              <div 
                key={p.id} 
                className={`pattern-card ${activeCandidateIndex === idx ? 'active' : ''}`}
                onClick={() => selectCandidate(idx)}
              >
                <span className="pattern-icon">{p.icon}</span>
                <span className="pattern-label">{p.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <main className="browser-grid">
        {error ? (
          <div style={{ gridColumn: 'span 3', padding: '3rem', textAlign: 'center', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '12px', border: '1px solid #ef4444' }}>
            <AlertTriangle size={48} color="#ef4444" style={{ marginBottom: '1rem' }} />
            <h2 style={{ color: '#ef4444' }}>エラーが発生しました</h2>
            <p style={{ color: '#f87171', marginTop: '0.5rem' }}>{error}</p>
            <button className="btn-primary" onClick={fetchBookmarks} style={{ margin: '1.5rem auto' }}>
              <RefreshCw size={18} />
              再試行
            </button>
          </div>
        ) : (
          <DndContext 
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {Object.keys(targetState).map(browser => (
              <BookmarkColumn 
                key={browser} 
                browser={browser} 
                data={targetState[browser]} 
                onSummarize={summarizeBookmarks}
                syncSettings={syncSettings[browser]}
                toggleSyncSetting={(rootKey) => toggleSyncSetting(browser, rootKey)}
                isPreview={!!previewState}
              />
            ))}
          </DndContext>
        )}
      </main>

      <footer style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
        <p style={{ color: '#ef4444', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertTriangle size={16} />
          <strong>警告:</strong> 「保存」を押下すると、現在開いているブラウザがすべて自動的に終了します。作業中のデータを保存してから実行してください。同期完了後、この画面（ローカルサーバー）が自動的に再起動します。
        </p>
      </footer>

      {logs.length > 0 && (
        <div className={`log-overlay ${showLogs ? '' : 'minimized'}`} style={{ width: showLogs ? '450px' : '200px' }}>
          <div className="log-header" onClick={() => setShowLogs(!showLogs)} style={{ cursor: 'pointer', userSelect: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexGrow: 1 }}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              <span>Server Live Logs</span>
            </div>
            <span style={{ fontSize: '1.2rem', fontWeight: 'bold', lineHeight: '1' }}>
              {showLogs ? '−' : '+'}
            </span>
          </div>
          {showLogs && (
            <div className="log-content">
              {logs.map((log, i) => (
                <div key={i} className={`log-entry ${log.type}`}>
                  <span className="log-time">{new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}</span>
                  <span className="log-msg">{log.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
