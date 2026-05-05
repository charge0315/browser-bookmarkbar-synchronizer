/**
 * @fileoverview React アプリケーションの開始点
 * 
 * 意図: React コンポーネントを DOM にマウントし、アプリケーションを起動するためです。
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

/**
 * ルート要素へのレンダリング実行
 * 
 * 意図: index.html 内の #root 要素に対して App コンポーネントを流し込み、UI を表示するためです。
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
