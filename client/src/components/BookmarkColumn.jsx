import React from 'react';
import { 
  SortableContext, 
  verticalListSortingStrategy 
} from '@dnd-kit/sortable';
import { Chrome, Globe, Pocket, Chrome as EdgeIcon, Zap } from 'lucide-react';
import { BookmarkItem } from './BookmarkItem';

const BROWSER_ICONS = {
  chrome: <Chrome size={20} color="#ea4335" />,
  edge: <EdgeIcon size={20} color="#0078d7" />,
  brave: <Zap size={20} color="#ff1b2d" />
};

export const BookmarkColumn = ({ browser, data, onSummarize }) => {
  const children = data?.roots?.bookmark_bar?.children || [];

  return (
    <div className="browser-column">
      <div className="column-header">
        {BROWSER_ICONS[browser] || <Globe size={20} color="#38bdf8" />}
        <h2 style={{ textTransform: 'capitalize' }}>{browser}</h2>
        <span className="status-indicator">{children.length} items</span>
      </div>
      
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
