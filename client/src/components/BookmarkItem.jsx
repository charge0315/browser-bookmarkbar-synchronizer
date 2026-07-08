/**
 * @fileoverview 個別のブックマーク項目（またはフォルダ）を表示するコンポーネント
 *
 * 意図: 単一のブックマークの情報を整理して表示し、DND-kit による
 * 並び替え操作のハンドル（属性）を提供するためです。
 */

import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Folder, MoreHorizontal, Pencil, Trash2, Check, X } from 'lucide-react';

/**
 * ブックマークアイテムコンポーネント
 *
 * 意図: アイテムがフォルダか通常のリンクかを判別し、適切なアイコンと情報をレンダリングするためです。
 * マージ後の一覧上で直接削除・編集できるようにし、手動での微調整を可能にします。
 *
 * @param {Object} props
 * @param {Object} props.item - ブックマークまたはフォルダのデータ
 * @param {Function} props.onSummarize - 個別要約ボタン押下時のコールバック
 * @param {Function} props.onDelete - 削除確定時のコールバック (itemId) => void
 * @param {Function} props.onEdit - 編集保存時のコールバック (itemId, patch) => void
 */
export const BookmarkItem = ({ item, onSummarize, onDelete, onEdit }) => {
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

  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(item?.name || '');
  const [draftUrl, setDraftUrl] = useState(item?.url || '');

  /**
   * ホスト名の抽出
   *
   * 意図: URLから主要なドメイン部分を抜き出し、ファビコン代わりのバッジとして表示するためです。
   */
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

  const startEdit = (e) => {
    e.stopPropagation();
    setDraftName(item?.name || '');
    setDraftUrl(item?.url || '');
    setIsEditing(true);
  };

  const cancelEdit = (e) => {
    e.stopPropagation();
    setIsEditing(false);
  };

  const saveEdit = (e) => {
    e.stopPropagation();
    const trimmedName = draftName.trim();
    if (!trimmedName) return;

    onEdit(item.id, isFolder ? { name: trimmedName } : { name: trimmedName, url: draftUrl.trim() });
    setIsEditing(false);
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    if (window.confirm(`「${item?.name}」を削除しますか？`)) {
      onDelete(item.id);
    }
  };

  if (isEditing) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`bookmark-item editing ${isFolder ? 'folder-item' : ''}`}
        data-testid="bookmark-item-editing"
      >
        <div className="bookmark-info" onPointerDown={(e) => e.stopPropagation()}>
          <input
            className="bookmark-edit-input"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="タイトル"
            data-testid="bookmark-edit-name"
            autoFocus
          />
          {!isFolder && (
            <input
              className="bookmark-edit-input"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="URL"
              data-testid="bookmark-edit-url"
            />
          )}
        </div>
        <div className="bookmark-actions">
          <button className="btn-icon" onClick={saveEdit} title="保存" data-testid="bookmark-save-button" style={{ padding: '4px', background: 'transparent', border: 'none' }}>
            <Check size={16} color="#10b981" />
          </button>
          <button className="btn-icon" onClick={cancelEdit} title="キャンセル" data-testid="bookmark-cancel-button" style={{ padding: '4px', background: 'transparent', border: 'none' }}>
            <X size={16} color="#94a3b8" />
          </button>
        </div>
      </div>
    );
  }

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
      <div className="bookmark-actions" onPointerDown={(e) => e.stopPropagation()}>
        <button
          className="btn-icon"
          onClick={startEdit}
          title="編集"
          data-testid="bookmark-edit-button"
          style={{ padding: '4px', background: 'transparent', border: 'none', color: '#94a3b8' }}
        >
          <Pencil size={14} />
        </button>
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
        <button
          className="btn-icon"
          onClick={handleDelete}
          title="削除"
          data-testid="bookmark-delete-button"
          style={{ padding: '4px', background: 'transparent', border: 'none', color: '#94a3b8' }}
        >
          <Trash2 size={14} color="#ef4444" />
        </button>
      </div>
    </div>
  );
};
