const functions = require('firebase-functions');
const fetch = require('node-fetch');
const languagePatterns = require('./utils/languages.json');

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// HTML Entity decoder function
const decodeHTMLEntities = (text) => {
  if (!text) return '';
  
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
    '&apos;': "'",
    '&#x2F;': '/',
    '&#x27;': "'",
    '&#x60;': '`',
    '&ldquo;': '"',
    '&rdquo;': '"',
    '&rsquo;': '\'',
    '&lsquo;': '\'',
    '&ndash;': '–',
    '&mdash;': '—'
  };
  
  return text.replace(/&[^;]+;/g, (entity) => {
    if (entities[entity]) {
      return entities[entity];
    } else {
      // For numeric entities like &#160;
      const match = entity.match(/&#(\d+);/);
      if (match) {
        return String.fromCharCode(match[1]);
      }
    }
    return entity;
  });
};

// Convert string patterns from JSON to RegExp objects
const LANGUAGE_PATTERNS = Object.entries(languagePatterns).reduce((acc, [lang, config]) => {
  acc[lang] = {
    ...config,
    pattern: new RegExp(config.pattern)
  };
  return acc;
}, {});

exports.googleReviewScraper = functions
  .runWith({
    timeoutSeconds: 30,
    memory: '2GB'
  })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    const url = req.query.url;
    if (!url) {
      res.status(400).json({ error: 'URL parameter is required' });
      return;
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
        }
      });

      const html = await response.text();

      // Get the page language
      const langMatch = html.match(/<html[^>]*lang="([^"]*)"/) || [];
      const pageLang = langMatch[1]?.split('-')[0] || 'en';

      // First get the meta tag with itemprop="description"
      const metaTag = html.match(/<meta[^>]*itemprop="description"[^>]*>/i)?.[0] || '';
      
      // Then extract the content attribute
      const contentMatch = metaTag.match(/content=(['"])(.*?)\1/);
      const fullContent = contentMatch ? contentMatch[2] : '';

      // Extract the review content - everything between quotes after the stars
      const reviewRegex = /^[★☆]+\s*"(.*?)"$/;
      const reviewMatch = fullContent.match(reviewRegex);
      const reviewContent = reviewMatch ? decodeHTMLEntities(reviewMatch[1]) : '';

      // Get name meta
      const nameMatch = html.match(/<meta[^>]*content=['"]([^'"]*)['"][^>]*itemprop=['"]name['"]/i);
      const name = nameMatch ? nameMatch[1] : '';

      // Try to match the review pattern in different languages
      let businessName = '';
      let reviewerName = '';
      let detectedLanguage = '';

      for (const [lang, pattern] of Object.entries(LANGUAGE_PATTERNS)) {
        const match = name.match(pattern.pattern);
        if (match) {
          businessName = decodeHTMLEntities(match[1].trim());
          reviewerName = decodeHTMLEntities(match[2].trim());
          detectedLanguage = lang;
          break;
        }
      }

      // Count stars for rating
      const rating = (fullContent.match(/★/g) || []).length;

      const data = {
        businessName,
        reviewerName,
        rating,
        reviewContent,
        language: {
          detected: detectedLanguage || pageLang,
          pageLang: pageLang
        },
      };

      res.status(200).json({
        success: true,
        data,
        debugInfo: {
          url,
          hasData: {
            businessName: !!data.businessName,
            reviewerName: !!data.reviewerName,
            reviewContent: !!data.reviewContent
          },
          statusCode: response.status,
        }
      });

    } catch (error) {
      console.error('Scraping error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to scrape data',
        details: {
          message: error.message
        }
      });
    }
});