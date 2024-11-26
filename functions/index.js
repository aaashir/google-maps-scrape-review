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
      const match = entity.match(/&#(\d+);/);
      if (match) {
        return String.fromCharCode(match[1]);
      }
    }
    return entity;
  });
};

// Extract content from meta tag
const extractMetaContent = (html, itemprop) => {
  const metaTag = html.match(new RegExp(`<meta[^>]*itemprop="${itemprop}"[^>]*>`, 'i'))?.[0] || '';
  const contentMatch = metaTag.match(/content=(['"])(.*?)\1/);
  return contentMatch ? decodeHTMLEntities(contentMatch[2]) : '';
};

const parseReviewTitle = (title) => {
  // German format: "Google-Rezension über {businessName} von {reviewerName}"
  const germanMatch = title.match(/Google-Rezension über (.*?) von (.*)/i);
  if (germanMatch) {
    return {
      businessName: germanMatch[1].trim(),
      reviewerName: germanMatch[2].trim()
    };
  }

  // English format: "Google review of {businessName} by {reviewerName}"
  const englishMatch = title.match(/Google review of (.*?) by (.*)/i);
  if (englishMatch) {
    return {
      businessName: englishMatch[1].trim(),
      reviewerName: englishMatch[2].trim()
    };
  }

  return { businessName: '', reviewerName: '' };
};

// Get review content based on language
const getReviewContent = (description, language) => {
  // Remove all star characters from the description
  const cleanDescription = description.replace(/[★☆]/g, '').trim();
  
  if (!cleanDescription) {
    return language === 'de' ? 'Es handelt sich um eine Sterne-Bewertung ohne Begründung' : 'This is a star rating without any review text';
  }

  // If there's text in quotes, extract it
  const quoteMatch = cleanDescription.match(/^"(.*?)"$/);
  if (quoteMatch) {
    return quoteMatch[1].trim();
  }

  // If there's any text after cleaning, return it
  return cleanDescription || (language === 'de' ? 'Es handelt sich um eine Sterne-Bewertung ohne Begründung' : 'This is a star rating without any review text');
};

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

      // Extract meta information
      const nameContent = extractMetaContent(html, 'name');
      const description = extractMetaContent(html, 'description');

      // Parse name content for business and reviewer names
      const { businessName, reviewerName } = parseReviewTitle(nameContent);

      // Count stars for rating
      const rating = (description.match(/★/g) || []).length;

      // Get review content with language-specific fallback
      const reviewContent = getReviewContent(description, pageLang);

      const data = {
        businessName,
        reviewerName,
        rating,
        reviewContent,
        language: {
          detected: pageLang,
          pageLang
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
          rawMeta: {
            name: nameContent,
            description
          }
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