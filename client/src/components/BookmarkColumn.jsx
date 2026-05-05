/**
 * @fileoverview ブラウザごとのブックマークリストを表示するカラムコンポーネント
 * 
 * 意図: 特定のブラウザ（Chrome, Edge等）に属するブックマーク一覧を垂直に並べ、
 * ドラッグ＆ドロップによる並び替えが可能なコンテナを提供するためです。
 */

import React from 'react';
import { 
  SortableContext, 
  verticalListSortingStrategy 
} from '@dnd-kit/sortable';
import { AppWindow, Monitor, Globe, Zap } from 'lucide-react';
import { BookmarkItem } from './BookmarkItem';

const BROWSER_ICONS = {
  chrome: <AppWindow size={20} color="#ea4335" />,
  edge: <Monitor size={20} color="#0078d7" />,
  brave: <Zap size={20} color="#ff1b2d" />
};

/**
 * ブックマークカラムコンポーネント
 * 
 * 意図: 単一ブラウザのブックマークデータを、ヘッダー、同期設定、リスト部分に分けて構築するためです。
 * 
 * @param {Object} props
 * @param {string} props.browser - ブラウザの識別子（chrome, edge等）
 * @param {Object} props.data - 当該ブラウザのブックマーク構造データ
 * @param {Function} props.onSummarize - タイトル要約実行時のコールバック
 * @param {Object} props.syncSettings - 同期対象設定（ブックマークバー、その他等）
 * @param {Function} props.toggleSyncSetting - 同期対象の切り替え関数
 * @param {boolean} props.isPreview - AIプレビュー表示中かどうか
 */
export const BookmarkColumn = ({ 
  browser, 
  data, 
  onSummarize, 
  syncSettings, 
  toggleSyncSetting,
  isPreview 
}) => {
  const children = data?.roots?.bookmark_bar?.children || [];

  return (
    <div className="browser-column" data-testid="bookmark-column" data-column-key={browser}>
      <div className="column-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {BROWSER_ICONS[browser] || <Globe size={20} color="#38bdf8" />}
          <h2 style={{ textTransform: 'capitalize' }}>{browser}</h2>
        </div>
        <span className="status-indicator">{children.length} items</span>
      </div>

      {!isPreview && syncSettings && (
        <div className="root-selector">
          <button 
            className={`root-toggle ${syncSettings.bookmark_bar ? 'active' : ''}`}
            onClick={() => toggleSyncSetting('bookmark_bar')}
            title="ブックマークバーを同期対象に含める"
          >
            Bar
          </button>
          <button 
            className={`root-toggle ${syncSettings.other ? 'active' : ''}`}
            onClick={() => toggleSyncSetting('other')}
            title="「その他のブックマーク」を同期対象に含める"
          >
            Other
          </button>
          <button 
            className={`root-toggle ${syncSettings.synced ? 'active' : ''}`}
            onClick={() => toggleSyncSetting('synced')}
            title="アカウント同期済みブックマークを同期対象に含める"
          >
            Synced
          </button>
        </div>
      )}
      
      <div className="bookmark-list">
        <SortableContext 
          id={browser}
          items={children.map(c => c.id)} 
          strategy={verticalListSortingStrategy}
        >
          {children.length > 0 ? (
            children.map(item => (
              <BookmarkItem 
                key={item.id} 
                item={item} 
                browser={browser}
                onSummarize={onSummarize}
              />
            ))
          ) : (
            <div style={{ textAlign: 'center', color: '#64748b', marginTop: '2rem', fontSize: '0.8rem' }}>
              ブックマークがありません。
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  );
};
