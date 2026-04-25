import { EventEmitter } from 'events';

// アプリ全体で進捗を共有するためのイベントエミッター
const progressEmitter = new EventEmitter();

/**
 * 進行状況をクライアントへ通知するためのイベントを発行します。
 * 
 * @param {string} message - 表示するメッセージ
 * @param {string} type - info, success, warning, error
 */
export const emitProgress = (message, type = 'info') => {
  progressEmitter.emit('progress', {
    message,
    type,
    timestamp: new Date().toISOString()
  });
};

export default progressEmitter;
