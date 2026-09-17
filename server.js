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

    return {
      ...source,
      url: streamUrl,
      headers: source.headers || {}
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
  seasonNumber: { type: Number, default: 1 }
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
// 5. مسار المشغل الرئيسي
// ==========================================
app.get('/api/animes/:id', async (req, res) => {
  try {
    const { id } = req.params;

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

    // 1. استخراج الاسم الأساسي للأنمي بتنظيف كل ما يتبع النقطتين الرأسيتين أو صياغات المواسم والآركات
    const rawTitle = anime.title?.en || anime.title || "";
    const cleanBaseTitle = rawTitle
      .split(':')[0]
      .replace(/\s*(2nd Season|Season \d+|Part \d+|\(TV\)|-).*/i, '')
      .trim();

    // 2. البحث عن جميع مواسم وآركات السلسلة المسجلة في جدول animes
    const franchiseAnimes = await Anime.find({
      $or: [
        { "title.en": { $regex: new RegExp(`^${cleanBaseTitle}`, "i") } },
        { _id: anime._id }
      ]
    });

    const franchiseIds = franchiseAnimes.map(a => a._id.toString());
    const franchiseUuids = franchiseAnimes.map(a => a.source_uuid).filter(Boolean);

    // 3. جلب جميع الحلقات التابعة لكل مواسم السلسلة
    let queryConditions = [
      { anime_id: { $in: franchiseIds } },
      { animeId: { $in: franchiseIds } },
      { source_uuid: { $in: franchiseUuids } }
    ];

    if (mongoose.Types.ObjectId.isValid(id)) {
      const objId = new mongoose.Types.ObjectId(id);
      queryConditions.push({ anime_id: objId }, { animeId: objId });
    }

    const rawEpisodes = await Episode.find({ $or: queryConditions })
      .sort({ seasonNumber: 1, episodeNumber: 1 });

    // 4. معالجة السيرفرات والترجمة وتوحيد التسميات
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

      const parsedSeasonNum = parseInt(epObj.seasonNumber, 10) || 1;

      // توحيد اسم الموسم ليبدأ بـ Season X حتى يتعرف عليه مشغل الأندرويد
      let sTitle = (epObj.seasonTitle || '').trim();
      if (!sTitle) {
        sTitle = `Season ${parsedSeasonNum}`;
      } else if (!sTitle.toLowerCase().startsWith('season')) {
        sTitle = `Season ${parsedSeasonNum}: ${sTitle}`;
      }

      return {
        ...epObj,
        title: typeof epObj.title === 'object' 
          ? (epObj.title.en || epObj.title.ar || `Episode ${epObj.episodeNumber}`) 
          : (epObj.title || `Episode ${epObj.episodeNumber}`),
        seasonNumber: parsedSeasonNum,
        seasonTitle: sTitle,
        sources: processedSources,
        subtitles: subtitles
      };
    });

    // 5. تجميع الحلقات داخل مصفوفة مواسم منظمة للمشغل بصيغة متوافقة تماماً
    const seasonsMap = new Map();
    formattedEpisodes.forEach(ep => {
      const sNum = parseInt(ep.seasonNumber, 10) || 1;
      const sTitle = ep.seasonTitle;

      if (!seasonsMap.has(sNum)) {
        seasonsMap.set(sNum, {
          title: sTitle,
          seasonTitle: sTitle,
          seasonNumber: sNum,
          episodes: []
        });
      }
      seasonsMap.get(sNum).episodes.push(ep);
    });

    const structuredSeasons = Array.from(seasonsMap.values())
      .sort((a, b) => a.seasonNumber - b.seasonNumber);

    // 6. تحديد مؤشر الموسم الافتراضي بدقة تامة باستخدام parseInt
    const currentSeasonNum = parseInt(anime.seasonNumber, 10) || 1;
    let targetSeasonIndex = structuredSeasons.findIndex(s => parseInt(s.seasonNumber, 10) === currentSeasonNum);

    // التحقق الاحتياطي بالاسم إذا اختلف الترقيم
    if (targetSeasonIndex === -1 && anime.seasonTitle) {
      targetSeasonIndex = structuredSeasons.findIndex(
        s => s.title && s.title.toLowerCase().trim() === anime.seasonTitle.toLowerCase().trim()
      );
    }

    if (targetSeasonIndex === -1) targetSeasonIndex = 0;

    // 7. إسناد حلقات الموسم المضغوط عليه مباشرة في حقل episodes
    const activeSeasonEpisodes = structuredSeasons[targetSeasonIndex]
      ? structuredSeasons[targetSeasonIndex].episodes
      : formattedEpisodes;

    res.json({
      success: true,
      data: {
        ...anime.toObject(),
        seasonNumber: currentSeasonNum,
        defaultSeasonIndex: targetSeasonIndex,
        seasons: structuredSeasons,
        episodes: activeSeasonEpisodes, // ⬅️ حلقات الموسم المختار مباشرة لواجهة المشغل
        allEpisodes: formattedEpisodes
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
