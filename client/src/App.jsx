/**
 * @fileoverview ブックマーク同期ツールのメインUIコンポーネント
 * 
 * 意図: ブラウザごとのブックマークを可視化し、AIによる自動整理や
 * ドラッグ＆ドロップによる手動マージ・調整を行うメイン画面を提供するためです。
 */

import React, { useEffect, useState } from 'react';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors
} from '@dnd-kit/core';
import { 
  arrayMove, 
  sortableKeyboardCoordinates 
} from '@dnd-kit/sortable';
import { 
  Save, 
  GitMerge, 
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
    previewState,
    setPreviewState,
    selectCandidate,
    fetchBookmarks, 
    saveAll, 
    mergeBookmarks, 
    summarizeBookmarks,
    aiOrganizeAll,
    applyPreviewAndSaveAll,
    resumeSync,
    rollbackAll,
    loadSampleData,
    logs,
    clearLogs,
    loading,
    error,
    saveStatus
  } = useBookmarks();

  /**
   * AIによる自動整理の実行ハンドラ
   * 
   * 意図: ログをクリアしてAI解析を開始し、最新のステータスをユーザーに表示するためです。
   */
  const handleAiOrganize = () => {
    clearLogs();
    aiOrganizeAll();
  };

  const [showLogs, setShowLogs] = useState(true);

  const targetState = previewState || bookmarks;
  const setTargetState = previewState ? setPreviewState : setBookmarks;

  /**
   * ツリー内の指定IDのノードを再帰的に除外します。
   *
   * 意図: マージ後の一覧からフォルダの深さに関わらず、目的のアイテムだけを安全に削除するためです。
   *
   * @param {Array<Object>} children - 探索対象のノード一覧
   * @param {string} itemId - 削除対象のID
   * @returns {Array<Object>} 削除後のノード一覧
   */
  const removeItemById = (children = [], itemId) => {
    return children
      .filter(child => child.id !== itemId)
      .map(child => (child.children ? { ...child, children: removeItemById(child.children, itemId) } : child));
  };

  /**
   * ツリー内の指定IDのノードを再帰的に更新します。
   *
   * 意図: フォルダの深さに関わらず、編集対象アイテムの名前やURLだけを差し替えるためです。
   *
   * @param {Array<Object>} children - 探索対象のノード一覧
   * @param {string} itemId - 更新対象のID
   * @param {Object} patch - 反映する差分
   * @returns {Array<Object>} 更新後のノード一覧
   */
  const updateItemById = (children = [], itemId, patch) => {
    return children.map(child => {
      if (child.id === itemId) {
        return { ...child, ...patch };
      }
      if (child.children) {
        return { ...child, children: updateItemById(child.children, itemId, patch) };
      }
      return child;
    });
  };

  /**
   * 指定コンテナ（ブラウザまたはカテゴリ）内のアイテムを削除します。
   */
  const handleDeleteItem = (containerKey, itemId) => {
    setTargetState(prev => ({
      ...prev,
      [containerKey]: {
        ...prev[containerKey],
        roots: {
          ...prev[containerKey].roots,
          bookmark_bar: {
            ...prev[containerKey].roots.bookmark_bar,
            children: removeItemById(prev[containerKey].roots.bookmark_bar.children, itemId)
          }
        }
      }
    }));
  };

  /**
   * 指定コンテナ（ブラウザまたはカテゴリ）内のアイテムを編集内容で更新します。
   */
  const handleUpdateItem = (containerKey, itemId, patch) => {
    setTargetState(prev => ({
      ...prev,
      [containerKey]: {
        ...prev[containerKey],
        roots: {
          ...prev[containerKey].roots,
          bookmark_bar: {
            ...prev[containerKey].roots.bookmark_bar,
            children: updateItemById(prev[containerKey].roots.bookmark_bar.children, itemId, patch)
          }
        }
      }
    }));
  };

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

  /**
   * アイテムがどのブラウザ（コンテナ）に属しているかを特定します。
   * 
   * 意図: ドラッグ操作中のアイテムが現在どこにあるか、またはどこへ移動しようとしているかを判定するためです。
   *
   * @param {string} id - アイテムのID
   * @returns {string|null} ブラウザ名（chrome, edge, braveなど）
   */
  const findContainer = (id) => {
    for (const key of Object.keys(targetState)) {
      if (targetState[key]?.roots?.bookmark_bar?.children.some(c => c.id === id)) {
        return key;
      }
    }
    return null;
  };

  /**
   * ドラッグ終了時の処理（ドロップ処理）
   * 
   * 意図: 同一ブラウザ内での並び替え、または異なるブラウザ間でのブックマークの移動を
   * 状態（State）に反映させ、UIを最新の状態に保つためです。
   */
  const handleDragEnd = (event) => {
    const { active, over } = event;
    const { id: activeId } = active;
    const { id: overId } = over || {};

    const activeContainer = findContainer(activeId);
    const overContainer = overId ? (overId in targetState ? overId : findContainer(overId)) : null;

    if (!activeContainer || !overContainer || activeContainer !== overContainer) {
      // 意図: 異なるブラウザ間（カラム間）でのドラッグ移動をサポートします。
      // これにより、あるブラウザのブックマークを別のブラウザへマージする操作を直感的に行えます。
      if (activeContainer && overContainer && activeContainer !== overContainer) {
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
            roots: {
              ...prev[activeContainer].roots,
              bookmark_bar: {
                ...prev[activeContainer].roots.bookmark_bar,
                children: sourceChildren
              }
            }
          },
          [overContainer]: {
            ...prev[overContainer],
            roots: {
              ...prev[overContainer].roots,
              bookmark_bar: {
                ...prev[overContainer].roots.bookmark_bar,
                children: destChildren
              }
            }
          }
        }));
      }
      return; 
    }

    // 意図: 同一ブラウザ内での並び替えを反映します。
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
                data-testid="ai-organize-button"
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
                data-testid="preview-save-button"
                style={{ padding: '0.6rem 2rem', fontSize: '1.05rem', background: '#10b981' }}
              >
                <Save size={20} />
                この内容で適用して保存
              </button>
            </>
          )}
        </div>
      </header>

      {saveStatus?.status && saveStatus.status !== 'idle' && (
        <section
          data-testid="save-status-banner"
          style={{
            marginBottom: '1.5rem',
            padding: '1rem 1.25rem',
            borderRadius: '12px',
            border: `1px solid ${
              saveStatus.status === 'success'
                ? 'rgba(16, 185, 129, 0.35)'
                : saveStatus.status === 'error'
                  ? 'rgba(239, 68, 68, 0.35)'
                  : saveStatus.status === 'awaiting-confirmation'
                    ? 'rgba(234, 179, 8, 0.4)'
                    : 'rgba(56, 189, 248, 0.35)'
            }`,
            background:
              saveStatus.status === 'success'
                ? 'rgba(16, 185, 129, 0.12)'
                : saveStatus.status === 'error'
                  ? 'rgba(239, 68, 68, 0.12)'
                  : saveStatus.status === 'awaiting-confirmation'
                    ? 'rgba(234, 179, 8, 0.12)'
                    : 'rgba(56, 189, 248, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <AlertTriangle
              size={18}
              color={
                saveStatus.status === 'success'
                  ? '#10b981'
                  : saveStatus.status === 'error'
                    ? '#ef4444'
                    : saveStatus.status === 'awaiting-confirmation'
                      ? '#eab308'
                      : '#38bdf8'
              }
            />
            <div>
              <div style={{ fontWeight: 700 }}>
                {saveStatus.status === 'running' && '保存シーケンス実行中'}
                {saveStatus.status === 'success' && '前回の保存は正常に完了しました'}
                {saveStatus.status === 'error' && '前回の保存で復旧処理が発生しました'}
                {saveStatus.status === 'awaiting-confirmation' && '内容確認待ち（同期は無効化されたままです）'}
              </div>
              <div style={{ fontSize: '0.9rem', color: '#cbd5e1', marginTop: '0.2rem' }}>
                {saveStatus.message}
              </div>
            </div>
          </div>
          {saveStatus.status === 'awaiting-confirmation' && (
            <button
              className="btn-primary"
              onClick={resumeSync}
              disabled={loading}
              data-testid="resume-sync-button"
              style={{ background: '#eab308', color: '#1e1b0d', flexShrink: 0 }}
            >
              <RefreshCw size={18} className={loading ? 'spin' : ''} />
              同期を再開する
            </button>
          )}
        </section>
      )}

      {previewCandidates.length > 0 && (
        <div className="pattern-selector">
          <h3>AI分類パターンを選択してください:</h3>
          <div className="pattern-cards">
            {previewCandidates.map((p, idx) => (
              <div 
                key={p.id} 
                className={`pattern-card ${activeCandidateIndex === idx ? 'active' : ''}`}
                onClick={() => selectCandidate(idx)}
                data-testid={`pattern-card-${p.id}`}
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
            onDragEnd={handleDragEnd}
          >
            {Object.keys(targetState).map(browser => (
              <BookmarkColumn 
                key={browser} 
                browser={browser} 
                data={targetState[browser]}
                onSummarize={summarizeBookmarks}
                onDeleteItem={(itemId) => handleDeleteItem(browser, itemId)}
                onUpdateItem={(itemId, patch) => handleUpdateItem(browser, itemId, patch)}
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
