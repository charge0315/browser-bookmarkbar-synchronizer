import { useState, useCallback } from 'react';
import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

/**
 * カスタムフック: ブックマークの操作と状態管理を提供します。
 *
 * 意図: フロントエンド内でバラバラになりがちなAPI通信や状態管理をこのフックに集約し、
 * コンポーネント側をUIレンダリングに専念させるためです。
 * 
 * @returns {Object} ブックマーク状態と各種操作関数
 */
export const useBookmarks = () => {
  const [bookmarks, setBookmarks] = useState({ chrome: null, edge: null, brave: null });
  const [previewState, setPreviewState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * サーバーから全ブラウザのブックマークを取得します。
   * 
   * 意図: 初期のマウント時や手動リロード時に最新情報を取得するためです。
   */
  const fetchBookmarks = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/bookmarks`);
      setBookmarks(response.data);
      setError(null);
    } catch (err) {
      setError('ブックマークの取得に失敗しました。サーバーが起動しているか確認してください。');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 現在のブックマークツリーを全ブラウザへ一括保存し、再起動要求を送るユーティリティです。
   * 
   * 意図: 手動・バッチでの通信エラーを防ぎ、安全・確実に反映およびブラウザ再起動を行います。
   */
  const saveAll = async () => {
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/save-all-reboot`, { bookmarksDict: bookmarks });
      alert('保存が完了しました。ブラウザが自動的に終了し、再起動しますので少々お待ちください。');
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
          } catch (err) {
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
      children.forEach(item => {
        if (item.type === 'folder' && item.children) {
          extractUrls(item.children);
        } else if (item.type === 'url' && item.url) {
          if (!uniqueUrlsMap.has(item.url)) {
            uniqueUrlsMap.set(item.url, { name: item.name, url: item.url });
          }
        }
      });
    };
    
    // 優先順位（Chrome > Edge > Brave）でパースします
    const priorityOrder = ['chrome', 'edge', 'brave'];
    priorityOrder.forEach(browserKey => {
      if (bookmarks[browserKey]?.roots?.bookmark_bar?.children) {
        extractUrls(bookmarks[browserKey].roots.bookmark_bar.children);
      }
    });

    Object.keys(bookmarks).forEach(browserKey => {
      if (!priorityOrder.includes(browserKey) && bookmarks[browserKey]?.roots?.bookmark_bar?.children) {
        extractUrls(bookmarks[browserKey].roots.bookmark_bar.children);
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
   * 
   * 意図: スマートな整理体験を提供するため、チャンク処理や階層化を統合して非同期実行します。
   * 
   * @param {boolean} alternative - 別観点での分類を要求するかどうか
   */
  const aiOrganizeAll = async (alternative = false) => {
    setLoading(true);
    setError(null);
    try {
      const allUrls = extractUniqueBookmarkUrls();
      if (allUrls.length === 0) {
        throw new Error('整理できるブックマークがありません。');
      }

      // サーバのAIエンジンによる分類処理をキックします
      const response = await axios.post(`${API_BASE}/ai-organize`, { items: allUrls, alternative });
      const organizedList = response.data;

      let idCounter = Date.now(); 
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

      // 限界数(20件)を超過している場合はサブカテゴリ化を実行します
      await applySubCategorization(categoryMap, idCounter);

      const newTree = [];
      Object.keys(categoryMap).sort().forEach(cat => {
        newTree.push({
          id: String(idCounter++),
          name: cat,
          type: 'folder',
          children: categoryMap[cat] // 中身がフラットなURL群か、追加サブフォルダ群のどちらかが入っています
        });
      });

      const newPreview = {};
      newTree.forEach(folder => {
        newPreview[folder.name] = {
          roots: {
            bookmark_bar: { children: folder.children || [] }
          }
        };
      });

      setPreviewState(newPreview);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'AI処理中にエラーが発生しました。');
      console.error(err);
    } finally {
      setLoading(false);
    }
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
          // 意図: ユーザーの「元のブックマークをすべて削除してから生成してほしい」という要望に応え、
          // ブックマークバーだけでなく、その他(other)や同期済み(synced)も含めて一旦空にします。
          const cleanRoots = { ...newBookmarks[browser].roots };
          
          if (cleanRoots.bookmark_bar) {
            cleanRoots.bookmark_bar = { ...cleanRoots.bookmark_bar, children: [...mergedList] };
          }
          if (cleanRoots.other) {
            cleanRoots.other = { ...cleanRoots.other, children: [] };
          }
          if (cleanRoots.synced) {
            cleanRoots.synced = { ...cleanRoots.synced, children: [] };
          }

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
      alert('保存が完了しました。ブラウザが自動的に再起動しますので少々お待ちください。');
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
    previewState,
    setPreviewState,
    loading,
    error,
    fetchBookmarks,
    saveAll,
    mergeBookmarks,
    organizeBookmarks,
    summarizeBookmarks,
    aiOrganizeAll,
    applyPreviewAndSaveAll,
    rollbackAll
  };
};
