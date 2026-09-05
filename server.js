const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. جدول قواعد السيرفرات والترويسات (تعدل هنا مستقبلاً عند أي تغيير)
// ==========================================
const SERVER_CONFIG = {
  megaplay: {
    // يستبدل أي نطاق قديم (مثل kryntal) بالنطاق النشط imgnex تلقائياً
    domainRegex: /cdn\.(kryntal|imgnex|[a-z0-9]+)\.top/i,
    activeDomain: "cdn.imgnex.top",
    headers: {
      "Referer": "https://megaplay.buzz/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }
  },
  zokoanime: {
    domainRegex: null,
    activeDomain: null,
    headers: {
      "Referer": "https://zokoanime.video/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }
  },
  megavid: {
    domainRegex: null,
    activeDomain: null,
    headers: {
      "Referer": "https://megavid.buzz/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }
  }
};

// دالة فحص وتصحيح روابط المصادر وإرفاق الترويسات
function processEpisodeSources(sources) {
  if (!sources || !Array.isArray(sources)) return [];

  return sources.map(source => {
    let serverKey = (source.serverName || source.name || '').toLowerCase().trim();
    let streamUrl = source.url || '';

    // التحقق من مفتاح السيرفر أو فحص الرابط للتعرف عليه تلقائياً
    let matchedConfig = SERVER_CONFIG[serverKey];
    if (!matchedConfig) {
      if (streamUrl.includes('megaplay') || streamUrl.includes('kryntal') || streamUrl.includes('imgnex')) {
        matchedConfig = SERVER_CONFIG['megaplay'];
      } else if (streamUrl.includes('aniwatch') || streamUrl.includes('zokoanime')) {
        matchedConfig = SERVER_CONFIG['zokoanime'];
      } else if (streamUrl.includes('megavid')) {
        matchedConfig = SERVER_CONFIG['megavid'];
      }
    }

    if (matchedConfig) {
      // تصحيح النطاق القديم إن وجد
      if (matchedConfig.domainRegex && matchedConfig.activeDomain) {
        streamUrl = streamUrl.replace(matchedConfig.domainRegex, matchedConfig.activeDomain);
      }

      return {
        ...source,
        url: streamUrl,
        headers: matchedConfig.headers
      };
    }

    // سيرفر بدون ترويسات خاصة
    return {
      ...source,
      url: streamUrl,
      headers: {}
    };
  });
}

// ==========================================
// 2. الاتصال بقاعدة البيانات
// ==========================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected successfully to MongoDB'))
  .catch((err) => console.error('❌ Database connection error:', err));

// ==========================================
// 3. النماذج (Schemas)
// ==========================================
const animeSchema = new mongoose.Schema({
  title: {
    en: { type: String, required: true },
    ar: { type: String }
  },
  description: {
    en: { type: String, required: true },
    ar: { type: String }
  },
  poster: { type: String, required: true },
  banner: { type: String, required: true },
  rating: { type: Number, default: 0 },
  releaseYear: { type: String, default: "2024" },
  category: { type: String, default: "Anime" },
  genres: [String],
  section: {
    type: String,
    enum: ['popular', 'trending', 'new_releases', 'continue_watching'],
    default: 'new_releases'
  },
  status: { type: String, default: 'Ongoing' }
}, { timestamps: true });

const episodeSchema = new mongoose.Schema({
  anime_id: { type: mongoose.Schema.Types.Mixed },
  animeId: { type: mongoose.Schema.Types.Mixed },
  seasonNumber: { type: Number, required: true, default: 1 },
  episodeNumber: { type: Number, required: true },
  title: { type: String },
  thumbnail: { type: String },
  sources: [
    {
      serverName: { type: String },
      quality: { type: String },
      url: { type: String, required: true },
      subtitles: [
        {
          lang: { type: String },
          url: { type: String }
        }
      ]
    }
  ],
  servers: [
    {
      name: { type: String },
      url: { type: String },
      type: { type: String }
    }
  ],
  subtitles: [
    {
      label: { type: String },
      lang: { type: String },
      language: { type: String },
      url: { type: String, required: true }
    }
  ]
}, { timestamps: true, strict: false });

const Anime = mongoose.model('Anime', animeSchema, 'animes');
const Episode = mongoose.model('Episode', episodeSchema, 'episodes');

// ==========================================
// 4. مسارات الكاتالوغ (Catalog Endpoints)
// ==========================================
app.get('/api/animes', async (req, res) => {
  try {
    const animes = await Anime.find().sort({ createdAt: -1 });
    res.json(animes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch animes' });
  }
});

// ==========================================
// 5. مسار المشغل الرئيسي (معالجة السيرفرات والترويسات)
// ==========================================
app.get('/api/animes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // جلب بيانات الأنمي
    const anime = await Anime.findById(id);
    if (!anime) {
      return res.status(404).json({ success: false, message: 'Anime not found' });
    }

    // جلب الحلقات
    let queryConditions = [
      { anime_id: id },
      { animeId: id }
    ];

    if (mongoose.Types.ObjectId.isValid(id)) {
      const objId = new mongoose.Types.ObjectId(id);
      queryConditions.push({ anime_id: objId }, { animeId: objId });
    }

    const rawEpisodes = await Episode.find({ $or: queryConditions }).sort({ seasonNumber: 1, episodeNumber: 1 });

    // توحيد التنسيق ومعالجة الترويسات والنطاقات لحظياً
    const formattedEpisodes = rawEpisodes.map(ep => {
      const epObj = ep.toObject();

      let sources = epObj.sources || [];
      if (sources.length === 0 && epObj.servers && epObj.servers.length > 0) {
        sources = epObj.servers.map(s => ({
          serverName: s.name || 'Server',
          quality: 'Auto',
          url: s.url
        }));
      }

      // تمرير المصادر لمعالجة النطاقات وحقن الترويسات
      const processedSources = processEpisodeSources(sources);

      let subtitles = epObj.subtitles || [];
      subtitles = subtitles.map(sub => ({
        lang: sub.lang || sub.language || sub.label || 'Arabic',
        url: sub.url
      }));

      return {
        ...epObj,
        title: typeof epObj.title === 'object' 
          ? (epObj.title.ar || epObj.title.en || `الحلقة ${epObj.episodeNumber}`) 
          : (epObj.title || `الحلقة ${epObj.episodeNumber}`),
        sources: processedSources,
        subtitles: subtitles
      };
    });

    res.json({
      success: true,
      data: {
        ...anime.toObject(),
        episodes: formattedEpisodes
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to fetch anime details and episodes' });
  }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
