const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. جدول قواعد السيرفرات والترويسات
// ==========================================
const SERVER_CONFIG = {
  megaplay: {
    domainRegex: /cdn\.(kryntal|imgnex|[a-z0-9]+)\.(top|me|buzz)/i,
    activeDomain: "cdn.imgnex.top",
    streamSuffix: "/index-f1-v1-a1.m3u8",
    headers: {
      "Referer": "https://megaplay.buzz/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }
  },
  zokoanime: {
    domainRegex: null,
    activeDomain: null,
    streamSuffix: null,
    headers: {
      "Referer": "https://zokoanime.video/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }
  },
  megavid: {
    domainRegex: null,
    activeDomain: null,
    streamSuffix: null,
    headers: {
      "Referer": "https://megavid.buzz/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }
  }
};

function processEpisodeSources(sources) {
  if (!sources || !Array.isArray(sources)) return [];

  return sources.map(source => {
    let serverKey = (source.serverName || source.name || '').toLowerCase().trim();
    let streamUrl = (source.url || '').trim();

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
      if (matchedConfig.domainRegex && matchedConfig.activeDomain) {
        streamUrl = streamUrl.replace(matchedConfig.domainRegex, matchedConfig.activeDomain);
      }

      if (matchedConfig.streamSuffix) {
        streamUrl = streamUrl.replace(/\/[^\/]+\.m3u8$/i, '');
        streamUrl = streamUrl.replace(/\/+$/, '');
        if (!streamUrl.endsWith(matchedConfig.streamSuffix)) {
          streamUrl = `${streamUrl}${matchedConfig.streamSuffix}`;
        }
      }

      return {
        ...source,
        url: streamUrl,
        headers: matchedConfig.headers
      };
    }

    // إذا كان الرابط لا يحتاج تعديلات، نضمن وجود ترويسة افتراضية سريعة
    return {
      ...source,
      url: streamUrl,
      headers: source.headers || {
        "User-Agent": "okhttp/4.12.0",
        "Accept": "*/*"
      }
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
  status: { type: String, default: 'Ongoing' },
  source_uuid: { type: String }
}, { timestamps: true, strict: false });

const episodeSchema = new mongoose.Schema({
  anime_id: { type: mongoose.Schema.Types.Mixed },
  animeId: { type: mongoose.Schema.Types.Mixed },
  seasonNumber: { type: Number, required: true, default: 1 },
  seasonTitle: { type: String, default: "Season 1" },
  episodeNumber: { type: Number, required: true },
  title: { type: String },
  thumbnail: { type: String },
  sources: [
    {
      serverName: { type: String },
      quality: { type: String },
      url: { type: String, required: true },
      headers: { type: Map, of: String },
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
// 5. مسار المشغل الرئيسي (المعدّل بدعم المواسم)
// ==========================================
app.get('/api/animes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 1. البحث عن الأنمي سواء بـ _id أو source_uuid
    let anime = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      anime = await Anime.findById(id);
    }
    if (!anime) {
      anime = await Anime.findOne({ source_uuid: id });
    }
    if (!anime) {
      return res.status(404).json({ success: false, message: 'Anime not found' });
    }

    const animeObjId = anime._id.toString();

    // 2. شروط البحث المرنة لجلب حلقات هذا الأنمي بكل المعرفات الممكنة
    let queryConditions = [
      { anime_id: animeObjId },
      { animeId: animeObjId },
      { anime_id: id },
      { animeId: id }
    ];

    if (mongoose.Types.ObjectId.isValid(id)) {
      const objId = new mongoose.Types.ObjectId(id);
      queryConditions.push({ anime_id: objId }, { animeId: objId });
    }
    if (anime.source_uuid) {
      queryConditions.push({ anime_id: anime.source_uuid }, { animeId: anime.source_uuid });
    }

    const rawEpisodes = await Episode.find({ $or: queryConditions })
      .sort({ seasonNumber: 1, episodeNumber: 1 });

    // 3. معالجة وتوحيد بيانات كل حلقة
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

      const processedSources = processEpisodeSources(sources);

      let subtitles = epObj.subtitles || [];
      subtitles = subtitles.map(sub => ({
        lang: sub.lang || sub.language || sub.label || 'English',
        url: sub.url
      }));

      return {
        ...epObj,
        title: typeof epObj.title === 'object' 
          ? (epObj.title.en || epObj.title.ar || `Episode ${epObj.episodeNumber}`) 
          : (epObj.title || `Episode ${epObj.episodeNumber}`),
        seasonNumber: epObj.seasonNumber || 1,
        seasonTitle: epObj.seasonTitle || `Season ${epObj.seasonNumber || 1}`,
        sources: processedSources,
        subtitles: subtitles
      };
    });

    // 4. تجميع الحلقات داخل هيكل مواسم منظم يطابق PlayerActivity
    const seasonsMap = new Map();

    formattedEpisodes.forEach(ep => {
      const sNum = ep.seasonNumber || 1;
      const sTitle = ep.seasonTitle || `Season ${sNum}`;

      if (!seasonsMap.has(sNum)) {
        seasonsMap.set(sNum, {
          title: sTitle,
          seasonNumber: sNum,
          episodes: []
        });
      }
      seasonsMap.get(sNum).episodes.push(ep);
    });

    const structuredSeasons = Array.from(seasonsMap.values())
      .sort((a, b) => a.seasonNumber - b.seasonNumber);

    // 5. إرجاع المواسم والحلقات معاً لضمان عمل المشغل فوراً
    res.json({
      success: true,
      data: {
        ...anime.toObject(),
        seasons: structuredSeasons,
        episodes: formattedEpisodes
      }
    });

  } catch (err) {
    console.error("Error in /api/animes/:id :", err);
    res.status(500).json({ success: false, error: 'Failed to fetch anime details and episodes' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
