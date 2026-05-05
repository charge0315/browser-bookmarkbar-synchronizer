/**
 * @fileoverview 進捗通知用イベント管理ユーティリティ
 * 
 * 意図: サーバー側の非同期処理（AI整理やファイル操作など）の途中経過を、
 * UI側へServer-Sent Eventsなどを通じてリアルタイムに配信するためです。
 */

import { EventEmitter } from 'events';

/**
 * アプリケーション全体で共有されるイベントバス
 * 
 * 意図: どこからでも進捗情報を投げ込める共通のハブを提供するためです。
 */
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
