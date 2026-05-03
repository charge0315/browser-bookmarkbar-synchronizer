import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Folder, MoreHorizontal } from 'lucide-react';

export const BookmarkItem = ({ item, onSummarize }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: item?.id || 'default' });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isFolder = item?.type === 'folder';
  const hostLabel = !isFolder && item?.url
    ? (() => {
        try {
          return new URL(item.url).hostname.replace(/^www\./, '');
        } catch {
          return 'link';
        }
      })()
    : '';
  const hostInitial = hostLabel ? hostLabel.charAt(0).toUpperCase() : 'F';

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...attributes} 
      {...listeners}
      className={`bookmark-item ${isFolder ? 'folder-item' : ''}`}
      data-testid="bookmark-item"
      data-bookmark-title={item?.name || ''}
    >
      <div className="bookmark-favicon">
        {!isFolder && item?.url ? (
          <div className="bookmark-favicon-badge" aria-label={hostLabel}>
            {hostInitial}
          </div>
        ) : (
          <Folder size={16} color="#3b82f6" />
        )}
      </div>
      <div className="bookmark-info">
        <div className="bookmark-title" title={item?.name}>{item?.name}</div>
        {isFolder ? (
          <div className="bookmark-url" style={{ color: '#3b82f6', fontWeight: 500 }}>
            {item?.children ? `${item.children.length} items` : 'Empty'}
          </div>
        ) : (
          <div className="bookmark-url" title={item?.url}>{item?.url}</div>
        )}
      </div>
      <button 
        className="btn-icon" 
        onClick={(e) => {
          e.stopPropagation();
          onSummarize(false, item?.id);
        }}
        title="AI要約"
        style={{ padding: '4px', background: 'transparent', border: 'none', color: '#94a3b8' }}
      >
        <MoreHorizontal size={16} />
      </button>
    </div>
  );
};
