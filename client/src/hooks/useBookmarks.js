import { useState, useCallback } from 'react';
import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

export const useBookmarks = () => {
  const [bookmarks, setBookmarks] = useState({ chrome: null, edge: null, brave: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchBookmarks = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/bookmarks`);
      setBookmarks(response.data);
      setError(null);
    } catch (err) {
      setError('Failed to fetch bookmarks. Make sure the server is running.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveAll = async () => {
    setLoading(true);
    try {
      for (const browser of Object.keys(bookmarks)) {
        if (bookmarks[browser]) {
          await axios.post(`${API_BASE}/save`, {
            browser,
            data: bookmarks[browser]
          });
        }
      }
      alert('保存しました。ブラウザを再起動して反映を確認してください。');
    } catch (err) {
      setError('Failed to save bookmarks.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const mergeBookmarks = () => {
    // Collect all bookmarks from all three
    const allItems = [];
    Object.values(bookmarks).forEach(browserData => {
      if (browserData?.roots?.bookmark_bar?.children) {
        allItems.push(...browserData.roots.bookmark_bar.children);
      }
    });

    // Deduplicate by URL
    const uniqueMap = new Map();
    allItems.forEach(item => {
      if (item.type === 'url' && item.url) {
        if (!uniqueMap.has(item.url)) {
          uniqueMap.set(item.url, item);
        } else {
          // Keep the one with longer title if duplicate
          const existing = uniqueMap.get(item.url);
          if (item.name.length > existing.name.length) {
            uniqueMap.set(item.url, item);
          }
        }
      }
    });

    const mergedList = Array.from(uniqueMap.values());
    
    // Apply merged list to all browsers (for preview)
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

  const organizeBookmarks = () => {
    const sortRecursive = (children) => {
      return [...children].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
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

  return {
    bookmarks,
    setBookmarks,
    loading,
    error,
    fetchBookmarks,
    saveAll,
    mergeBookmarks,
    organizeBookmarks,
    summarizeBookmarks
  };
};
