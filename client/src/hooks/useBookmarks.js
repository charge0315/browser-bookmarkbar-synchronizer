import { useState, useCallback, useEffect } from 'react';
import axios from 'axios';

const getApiBase = () => {
  if (typeof window === 'undefined') {
    return 'http://localhost:3001/api';
  }

  const { protocol, hostname } = window.location;
  const normalizedHostname = hostname.includes(':') && !hostname.startsWith('[')
    ? `[${hostname}]`
    : hostname;

  return `${protocol}//${normalizedHostname}:3001/api`;
};

const API_BASE = getApiBase();

/**
 * ノード配列を深く複製します。
 *
 * 意図: プレビュー編集時に候補データの原本を壊さず、現在選択中の状態だけを安全に更新するためです。
 *
 * @param {Array<Object>} nodes - 複製対象ノード一覧
 * @returns {Array<Object>} 複製後ノード一覧
 */
const cloneTreeNodes = (nodes = []) => {
  return nodes.map(node => ({
    ...node,
    children: node.children ? cloneTreeNodes(node.children) : undefined
  }));
};

/**
 * プレビュー候補全体を複製します。
 *
 * 意図: 候補切り替え時にも、編集用 state と候補一覧が参照共有しないようにするためです。
 *
 * @param {Record<string, Object>} previewData - 複製対象プレビュー
 * @returns {Record<string, Object>} 複製後プレビュー
 */
const clonePreviewData = (previewData = {}) => {
  return Object.fromEntries(
    Object.entries(previewData).map(([key, value]) => [
      key,
      {
        ...value,
        roots: {
          ...value.roots,
          bookmark_bar: {
            ...value.roots?.bookmark_bar,
            children: cloneTreeNodes(value.roots?.bookmark_bar?.children || [])
          }
        }
      }
    ])
  );
};

/**
 * カスタムフック: ブックマークの操作と状態管理を提供します。
 *
 * 意図: フロントエンド内でバラバラになりがちなAPI通信や状態管理をこのフックに集約し、
 * コンポーネント側をUIレンダリングに専念させるためです。
 * 
 * @returns {Object} ブックマーク状態と各種操作関数
 */
export const useBookmarks = () => {
  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';
  const [bookmarks, setBookmarks] = useState({ chrome: null, edge: null, brave: null });
  const [syncSettings, setSyncSettings] = useState({
    chrome: { bookmark_bar: true, other: true, synced: false },
    edge: { bookmark_bar: true, other: true, synced: false },
    brave: { bookmark_bar: true, other: true, synced: false }
  });
  const [previewCandidates, setPreviewCandidates] = useState([]);
  const [activeCandidateIndex, setActiveCandidateIndex] = useState(-1);
  const [previewState, setPreviewState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  const [saveStatus, setSaveStatus] = useState({
    status: 'idle',
    message: '保存ジョブはまだ実行されていません。'
  });

  /**
   * サーバーからのリアルタイムイベント（SSE）を購読します。
   */
  useEffect(() => {
    if (isDemoMode) {
      return undefined;
    }

    const eventSource = new EventSource(`${API_BASE}/events`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setLogs((prev) => [...prev.slice(-4), data]); // 最新5件のみ保持
    };

    return () => {
      eventSource.close();
    };
  }, [isDemoMode]);

  const clearLogs = () => setLogs([]);

  /**
   * 保存ジョブの最終状態を取得します。
   *
   * 意図: ブラウザ再起動後でも、直前の保存結果を UI 上で追跡できるようにするためです。
   */
  const fetchSaveStatus = useCallback(async () => {
    if (isDemoMode) {
      return;
    }

    try {
      const response = await axios.get(`${API_BASE}/save-status`);
      setSaveStatus(response.data);
    } catch (err) {
      console.error('Failed to fetch save status:', err);
    }
  }, [isDemoMode]);

  /**
   * サーバーから全ブラウザのブックマークを取得します。
   * 
   * 意図: 初期のマウント時や手動リロード時に最新情報を取得するためです。
   */
  const fetchBookmarks = useCallback(async () => {
    console.log('Fetching bookmarks...');
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/bookmarks`);
      console.log('Bookmarks fetched successfully');
      setBookmarks(response.data);
      setError(null);
    } catch (err) {
      console.error('Fetch error:', err);
      setError('ブックマークの取得に失敗しました。サーバーが起動しているか確認してください。');
    } finally {
      console.log('Setting loading to false');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSaveStatus();
  }, [fetchSaveStatus]);

  /**
   * 現在のブックマークツリーを全ブラウザへ一括保存し、再起動要求を送るユーティリティです。
   * 
   * 意図: 手動・バッチでの通信エラーを防ぎ、安全・確実に反映およびブラウザ再起動を行います。
   */
  const saveAll = async () => {
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/save-all-reboot`, { bookmarksDict: bookmarks });
      setSaveStatus({
        status: 'running',
        message: '保存シーケンスを開始しました。ブラウザが順次再起動します。'
      });
      alert('保存シーケンスを開始しました。ブラウザが順次再起動したあと、この画面で最終結果を確認できます。');
    } catch (err) {
      setError('ブックマークの保存と再起動リクエストに失敗しました。');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * ロールバックAPIを利用し、直前のバックアップから復旧します。
   * 
   * 意図: 誤ったAI整理や手動ミスによる破壊的変更を取り消すためのセーフティネットです。
   */
  const rollbackAll = async () => {
    setLoading(true);
    try {
      let rolledBack = false;
      for (const browser of Object.keys(bookmarks)) {
        if (bookmarks[browser]) {
          try {
            await axios.post(`${API_BASE}/rollback`, { browser });
            rolledBack = true;
          } catch (e) {
            console.warn(`Rollback failed or skipped for ${browser}:`, e);
          }
        }
      }
      if (rolledBack) {
        alert('直前の状態に復旧しました。最新の状態を再読み込みします。');
        await fetchBookmarks();
      } else {
        alert('元に戻すためのバックアップが見つかりませんでした。');
      }
    } catch (err) {
      setError('復旧処理に失敗しました。');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * デモ用にクリーンなサンプルデータを読み込みます。
   * 意図: スクリーンショット撮影時などにプライベートなブックマークを隠すためです。
   */
  const loadSampleData = useCallback(() => {
    const sample = {
      chrome: {
        roots: {
          bookmark_bar: {
            children: [
              { id: 's1', type: 'url', name: 'GitHub', url: 'https://github.com' },
              { id: 's2', type: 'url', name: 'Stack Overflow', url: 'https://stackoverflow.com' },
              { id: 's3', type: 'url', name: 'React Docs', url: 'https://react.dev' },
              { id: 's4', type: 'folder', name: '🛒 Shopping', children: [
                { id: 's5', type: 'url', name: 'Amazon', url: 'https://www.amazon.co.jp' },
                { id: 's6', type: 'url', name: 'Rakuten', url: 'https://www.rakuten.co.jp' }
              ]}
            ]
          }
        }
      },
      edge: {
        roots: {
          bookmark_bar: {
            children: [
              { id: 's7', type: 'url', name: 'Microsoft Learn', url: 'https://learn.microsoft.com' },
              { id: 's8', type: 'url', name: 'Azure Portal', url: 'https://portal.azure.com' }
            ]
          }
        }
      },
      brave: {
        roots: {
          bookmark_bar: {
            children: [
              { id: 's9', type: 'url', name: 'Brave Search', url: 'https://search.brave.com' },
              { id: 's10', type: 'url', name: 'TechCrunch', url: 'https://techcrunch.com' }
            ]
          }
        }
      }
    };
    setBookmarks(sample);
  }, []);

  /**
   * 同一名・同一URLの重複を排除しながら、ローカルでブックマークを統合します。
   * 
   * 意図: AIリクエストを行わずに、手動で手早く重複削除したい場合の機能です。
   */
  const mergeBookmarks = () => {
    const allItems = [];
    Object.values(bookmarks).forEach(browserData => {
      if (browserData?.roots?.bookmark_bar?.children) {
        allItems.push(...browserData.roots.bookmark_bar.children);
      }
    });

    const uniqueUrls = new Map();
    const uniqueFolders = new Map();

    allItems.forEach(item => {
      if (item.type === 'folder') {
        const key = item.name || '';
        if (!uniqueFolders.has(key)) {
          uniqueFolders.set(key, item);
        } else {
          const existing = uniqueFolders.get(key);
          if ((item.children?.length || 0) > (existing.children?.length || 0)) {
            uniqueFolders.set(key, item);
          }
        }
      } else if (item.type === 'url' && item.url) {
        if (!uniqueUrls.has(item.url)) {
          uniqueUrls.set(item.url, item);
        } else {
          const existing = uniqueUrls.get(item.url);
          if ((item.name || '').length > (existing.name || '').length) {
            uniqueUrls.set(item.url, item);
          }
        }
      }
    });

    const mergedList = [
      ...Array.from(uniqueFolders.values()),
      ...Array.from(uniqueUrls.values())
    ];
    
    const newBookmarks = { ...bookmarks };
    Object.keys(newBookmarks).forEach(browser => {
      if (newBookmarks[browser]) {
        newBookmarks[browser] = {
          ...newBookmarks[browser],
          roots: {
            ...newBookmarks[browser].roots,
            bookmark_bar: {
              ...newBookmarks[browser].roots.bookmark_bar,
              children: [...mergedList]
            }
          }
        };
      }
    });
    setBookmarks(newBookmarks);
  };

  /**
   * フォルダ内の要素をアルファベット・五十音順にソートします。
   * 
   * 意図: 並び順を綺麗に整頓することで、目視での検索性を高めるためです。
   */
  const organizeBookmarks = () => {
    const sortRecursive = (children) => {
      const folders = children.filter(c => c.type === 'folder');
      const urls = children.filter(c => c.type === 'url' || !c.type);

      folders.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
      urls.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));

      const newFolders = folders.map(folder => {
        if (folder.children) {
          return { ...folder, children: sortRecursive(folder.children) };
        }
        return folder;
      });

      return [...newFolders, ...urls];
    };

    const newBookmarks = { ...bookmarks };
    Object.keys(newBookmarks).forEach(browser => {
      if (newBookmarks[browser]?.roots?.bookmark_bar?.children) {
        newBookmarks[browser].roots.bookmark_bar.children = sortRecursive(
          newBookmarks[browser].roots.bookmark_bar.children
        );
      }
    });
    setBookmarks(newBookmarks);
  };

  /**
   * AIを利用して特定のブックマーク名を短く要約します。
   * 
   * 意図: URLタイトルが長すぎてツールバーを占領するのを防ぐためです。
   * 
   * @param {boolean} isBulk - 一括処理するかどうか
   * @param {string} targetId - 単一処理対象のID
   */
  const summarizeBookmarks = async (isBulk = true, targetId = null) => {
    setLoading(true);
    try {
      const newBookmarks = { ...bookmarks };
      
      const processItem = async (item) => {
        if (item.type === 'url' && (isBulk || item.id === targetId)) {
          try {
            const res = await axios.post(`${API_BASE}/summarize`, { title: item.name });
            return { ...item, name: res.data.summary };
          } catch {
            console.error('Failed to summarize:', item.name);
            return item;
          }
        }
        if (item.children) {
          return { ...item, children: await Promise.all(item.children.map(processItem)) };
        }
        return item;
      };

      for (const browser of Object.keys(newBookmarks)) {
        if (newBookmarks[browser]?.roots?.bookmark_bar?.children) {
          newBookmarks[browser].roots.bookmark_bar.children = await Promise.all(
            newBookmarks[browser].roots.bookmark_bar.children.map(processItem)
          );
        }
      }
      setBookmarks({ ...newBookmarks });
    } catch (err) {
      setError('AI要約中にエラーが発生しました。');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * クロスブラウザマージエンジン: ブラウザ優先度順に一意のURLリストを抽出します。
   * 
   * 意図: 複数ブラウザに跨る重複URLを綺麗に1本化するため、優先順位(Chromeなど)を考慮してマージします。
   * 
   * @returns {Array<Object>} 重複排除されたURLリスト
   */
   const extractUniqueBookmarkUrls = () => {
    const uniqueUrlsMap = new Map();
    const extractUrls = (children) => {
      if (!children) return;
      children.forEach(item => {
        if (item.type === 'folder' && item.children) {
          extractUrls(item.children);
        } else if (item.type === 'url' && item.url) {
          // 重複は一本化（最初に見つけたものを優先）
          if (!uniqueUrlsMap.has(item.url)) {
            uniqueUrlsMap.set(item.url, { name: item.name, url: item.url });
          }
        }
      });
    };
    
    const priorityOrder = ['chrome', 'edge', 'brave'];

    // 優先順位に従ってブラウザごとに処理
    const browsers = [...priorityOrder, ...Object.keys(bookmarks).filter(b => !priorityOrder.includes(b))];

    browsers.forEach(browserKey => {
      const browserData = bookmarks[browserKey];
      const settings = syncSettings[browserKey] || { bookmark_bar: true, other: true, synced: false };
      
      if (browserData?.roots) {
        // 設定に基づいて抽出するルートを決定
        Object.keys(settings).forEach(rootKey => {
          if (settings[rootKey] && browserData.roots[rootKey]?.children) {
            extractUrls(browserData.roots[rootKey].children);
          }
        });
      }
    });

    return Array.from(uniqueUrlsMap.values());
  };

  /**
   * 20以上の要素を持つカテゴリをサブカテゴリ(小分類)に分割します。
   * 
   * 意図: 1フォルダにブックマークが溢れかえるのを防ぐため、階層構造化をします。
   * 
   * @param {Object} categoryMap - 親カテゴリをキーとした要素リストのマップ
   * @param {number} idCounter - ID生成用カウンター
   */
  const applySubCategorization = async (categoryMap, idCounter) => {
    for (const [catName, items] of Object.entries(categoryMap)) {
      if (items.length >= 20) {
        try {
          const res = await axios.post(`${API_BASE}/sub-organize`, { 
            items, 
            parentCategory: catName 
          });
          
          const subOrganized = res.data;
          if (subOrganized && subOrganized.length > 0) {
            // サブカテゴリマップを新たに作成します
            const subCatMap = {};
            subOrganized.forEach(subItem => {
              const subCatName = subItem.category || '📦 その他';
              if (!subCatMap[subCatName]) subCatMap[subCatName] = [];
              subCatMap[subCatName].push({
                id: String(idCounter++),
                name: subItem.name,
                url: subItem.url,
                type: 'url'
              });
            });

            // 親カテゴリ配下のフラットなアイテムをサブフォルダ群へ置き換えます
            const newSubFolders = Object.keys(subCatMap).sort().map(sc => ({
              id: String(idCounter++),
              name: sc,
              type: 'folder',
              children: subCatMap[sc]
            }));
            
            categoryMap[catName] = newSubFolders;
          }
        } catch (error) {
          console.error(`Sub-categorization failed for ${catName}`, error);
        }
      }
    }
  };

  /**
   * 全ブラウザのブックマークを抽出し、AIエンジンへ送信してプレビュー画面を構築します。
   * 複数の分類パターンを並列で生成し、ユーザーが選択できるようにします。
   */
  const aiOrganizeAll = async () => {
    setLoading(true);
    setError(null);
    setPreviewCandidates([]);
    setActiveCandidateIndex(-1);

    try {
      const allUrls = extractUniqueBookmarkUrls();
      if (allUrls.length === 0) {
        throw new Error('整理できるブックマークがありません。');
      }

      const perspectives = [
        { id: 'default', label: '標準的な分類', icon: '📦' },
        { id: 'functional', label: '目的・役割別', icon: '🛠️' },
        { id: 'topic', label: 'コンテンツ・分野別', icon: '🌐' }
      ];

      const generatePattern = async (p) => {
        const response = await axios.post(`${API_BASE}/ai-organize`, { 
          items: allUrls, 
          perspective: p.id 
        });
        const organizedList = response.data;

        let idCounter = Date.now() + Math.random() * 1000;
        const categoryMap = {};

        organizedList.forEach(item => {
          const cat = item.category || '📦 その他';
          if (!categoryMap[cat]) categoryMap[cat] = [];
          categoryMap[cat].push({
            id: String(idCounter++),
            name: item.name,
            url: item.url,
            type: 'url'
          });
        });

        await applySubCategorization(categoryMap, idCounter);

        const newTree = [];
        Object.keys(categoryMap).sort().forEach(cat => {
          newTree.push({
            id: String(idCounter++),
            name: cat,
            type: 'folder',
            children: categoryMap[cat]
          });
        });

        const treeData = {};
        newTree.forEach(folder => {
          treeData[folder.name] = {
            roots: {
              bookmark_bar: { children: folder.children || [] }
            }
          };
        });

        return {
          ...p,
          data: treeData
        };
      };

      // 並列で3パターン生成
      const results = await Promise.all(perspectives.map(generatePattern));

      setPreviewCandidates(results);
      setActiveCandidateIndex(0);
      setPreviewState(clonePreviewData(results[0].data));
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'AI処理中にエラーが発生しました。');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 選択された分類パターンを現在のプレビューとしてセットします。
   */
  const selectCandidate = (index) => {
    setActiveCandidateIndex(index);
    setPreviewState(clonePreviewData(previewCandidates[index].data));
  };

  /**
   * ブラウザごとの同期設定（どのルートを抽出・上書き対象にするか）を切り替えます。
   */
  const toggleSyncSetting = (browser, rootKey) => {
    setSyncSettings(prev => {
      const current = prev[browser] || { bookmark_bar: true, other: true, synced: false };
      return {
        ...prev,
        [browser]: {
          ...current,
          [rootKey]: !current[rootKey]
        }
      };
    });
  };

  /**
   * プレビューでの確認結果を採用し、全てのブラウザ情報として一括保存、再起動要求を送ります。
   * 
   * 意図: 手動・バッチ通信ではなく統合APIを用いることで、
   * プロセスキル時の通信エラーを防ぎ、安全・確実に反映およびブラウザ再起動を行います。
   */
  const applyPreviewAndSaveAll = async () => {
    if (!previewState) return;
    setLoading(true);
    try {
      const mergedList = Object.keys(previewState).map((catName, index) => ({
        id: String(Date.now() + index),
        name: catName,
        type: 'folder',
        children: previewState[catName].roots.bookmark_bar.children
      }));

      const newBookmarks = { ...bookmarks };
      for (const browser of Object.keys(newBookmarks)) {
        if (newBookmarks[browser] && newBookmarks[browser].roots) {
          const settings = syncSettings[browser] || { bookmark_bar: true, other: true, synced: false };
          const cleanRoots = { ...newBookmarks[browser].roots };

          let idCounter = Date.now();
          const cloneNodesWithFreshIds = (nodes) => {
            return nodes.map(node => ({
              ...node,
              id: String(idCounter++),
              children: node.children ? cloneNodesWithFreshIds(node.children) : undefined
            }));
          };

          const selectedRoots = Object.keys(settings).filter(rootKey => settings[rootKey]);

          // 意図: 選択されたルートだけを更新し、未選択ルートはそのまま保護します。
          selectedRoots.forEach(rootKey => {
            cleanRoots[rootKey] = {
              ...cleanRoots[rootKey],
              children: cloneNodesWithFreshIds(mergedList)
            };
          });

          newBookmarks[browser] = {
            ...newBookmarks[browser],
            roots: cleanRoots
          };
        }
      }

      setBookmarks(newBookmarks);
      setPreviewState(null);

      // 自動全再起動エンドポイントへリクエスト
      await axios.post(`${API_BASE}/save-all-reboot`, { bookmarksDict: newBookmarks });
      setSaveStatus({
        status: 'running',
        message: '保存シーケンスを開始しました。ブラウザが順次再起動します。'
      });
      alert('保存シーケンスを開始しました。ブラウザが順次再起動したあと、この画面で最終結果を確認できます。');
    } catch (err) {
      setError('サーバーへの保存と再起動リクエスト中にエラーが発生しました。');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return {
    bookmarks,
    setBookmarks,
    syncSettings,
    toggleSyncSetting,
    previewCandidates,
    activeCandidateIndex,
    previewState,
    setPreviewState,
    selectCandidate,
    loading,
    error,
    saveStatus,
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
    fetchSaveStatus
  };
};
