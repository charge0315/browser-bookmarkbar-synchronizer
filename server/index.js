import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { getBookmarks, saveBookmarks, BROWSER_PATHS } from './utils/path-finder.js';
import { summarizeTitle } from './utils/gemini.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(morgan('dev'));

app.get('/api/bookmarks', (req, res) => {
  try {
    const results = {};
    for (const browser of Object.keys(BROWSER_PATHS)) {
      results[browser] = getBookmarks(browser);
    }
    res.json(results);
  } catch (error) {
    console.error('Error fetching bookmarks:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/save', (req, res) => {
  const { browser, data } = req.body;
  if (!browser || !data) {
    return res.status(400).json({ error: 'Missing browser or data' });
  }

  try {
    saveBookmarks(browser, data);
    res.json({ message: `Successfully saved bookmarks for ${browser}` });
  } catch (error) {
    console.error(`Error saving bookmarks for ${browser}:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/summarize', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Missing title' });

  try {
    const summary = await summarizeTitle(title);
    res.json({ summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
