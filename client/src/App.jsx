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
  AlertTriangle 
} from 'lucide-react';
import { useBookmarks } from './hooks/useBookmarks';
import { BookmarkColumn } from './components/BookmarkColumn';
import './App.css';

function App() {
  const { 
    bookmarks, 
    setBookmarks, 
    fetchBookmarks, 
    saveAll, 
    mergeBookmarks, 
    organizeBookmarks, 
    summarizeBookmarks,
    loading,
    error
  } = useBookmarks();

  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    fetchBookmarks();
  }, [fetchBookmarks]);

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
    for (const browser of Object.keys(bookmarks)) {
      if (bookmarks[browser]?.roots?.bookmark_bar?.children.some(c => c.id === id)) {
        return browser;
      }
    }
    return null;
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    const { id: activeId } = active;
    const { id: overId } = over || {};

    const activeContainer = findContainer(activeId);
    const overContainer = overId ? (overId in bookmarks ? overId : findContainer(overId)) : null;

    if (!activeContainer || !overContainer || activeContainer !== overContainer) {
      setActiveId(null);
      return; 
    }

    if (activeId !== overId) {
      const children = bookmarks[activeContainer].roots.bookmark_bar.children;
      const oldIndex = children.findIndex(c => c.id === activeId);
      const newIndex = children.findIndex(c => c.id === overId);

      const newChildren = arrayMove(children, oldIndex, newIndex);
      setBookmarks(prev => ({
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
            各ブラウザのブックマークバーを統合・整理します。
          </p>
        </div>
        <div className="controls">
          <button className="btn-secondary" onClick={fetchBookmarks} disabled={loading}>
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
            再読み込み
          </button>
          <button className="btn-secondary" onClick={mergeBookmarks}>
            <GitMerge size={18} />
            マージ
          </button>
          <button className="btn-secondary" onClick={() => summarizeBookmarks(true)}>
            <Type size={18} />
            要約
          </button>
          <button className="btn-secondary" onClick={organizeBookmarks}>
            <ListOrdered size={18} />
            整理
          </button>
          <button className="btn-primary" onClick={saveAll}>
            <Save size={18} />
            保存
          </button>
        </div>
      </header>

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
            {Object.keys(bookmarks).map(browser => (
              <BookmarkColumn 
                key={browser} 
                browser={browser} 
                data={bookmarks[browser]} 
                onSummarize={summarizeBookmarks}
              />
            ))}
          </DndContext>
        )}
      </main>

      <footer style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(234, 179, 8, 0.1)', borderRadius: '8px', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
        <p style={{ color: '#eab308', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertTriangle size={16} />
          <strong>重要:</strong> 「保存」実行前に、すべてのブラウザを終了させてください。起動中に保存すると、変更が反映されない場合があります。
        </p>
      </footer>
    </div>
  );
}

export default App;
