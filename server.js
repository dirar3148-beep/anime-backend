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

    // 4. معالجة السيرفرات والترجمة وعرض عنوان الآرك كما هو بدون إضافة "Season"
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
      // استخدام عنوان الموسم الأصلي المسجل بالحلقة كما هو
      const sTitle = (epObj.seasonTitle || '').trim() || `Season ${parsedSeasonNum}`;

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

    // 5. تجميع الحلقات داخل مصفوفة مواسم نظيفة تعتمد العنوان الأصلي
    const seasonsMap = new Map();
    formattedEpisodes.forEach(ep => {
      // الاعتماد على العنوان أولاً أو رقم الموسم كمفتاح تجميع
      const sKey = ep.seasonTitle || `Season ${ep.seasonNumber}`;
      const sNum = ep.seasonNumber;

      if (!seasonsMap.has(sKey)) {
        seasonsMap.set(sKey, {
          title: sKey,
          seasonTitle: sKey,
          seasonNumber: sNum,
          episodes: []
        });
      }
      seasonsMap.get(sKey).episodes.push(ep);
    });

    const structuredSeasons = Array.from(seasonsMap.values())
      .sort((a, b) => a.seasonNumber - b.seasonNumber);

    // 6. تحديد مؤشر الموسم عبر المطابقة المباشرة مع عنوان العمل في الكتالوج (Title Matching)
    // استخراج عنوان الآرك الخاص بالعنصر المضغوط عليه (سواء كان في seasonTitle أو بعد النقطتين في الاسم)
    const clickedSeasonTitle = (anime.seasonTitle || '').toLowerCase().trim();
    const clickedSubtitlePart = rawTitle.includes(':') 
      ? rawTitle.split(':')[1].toLowerCase().trim() 
      : rawTitle.toLowerCase().trim();

    let targetSeasonIndex = structuredSeasons.findIndex(s => {
      const sTitleLower = (s.title || '').toLowerCase().trim();
      // مطابقة بالاسم الكامل المسجل للموسم
      if (clickedSeasonTitle && sTitleLower === clickedSeasonTitle) return true;
      // مطابقة إذا كان عنوان الموسم يحتوي على الجزء الخاص بالآرك (مثل East Blue)
      if (clickedSubtitlePart && (sTitleLower.includes(clickedSubtitlePart) || clickedSubtitlePart.includes(sTitleLower))) return true;
      return false;
    });

    // احتياطي: إذا لم يتطابق بالاسم، يطابق برقم الموسم
    if (targetSeasonIndex === -1) {
      const currentSeasonNum = parseInt(anime.seasonNumber, 10) || 1;
      targetSeasonIndex = structuredSeasons.findIndex(s => s.seasonNumber === currentSeasonNum);
    }

    if (targetSeasonIndex === -1) targetSeasonIndex = 0;

    // 7. إسناد حلقات الموسم المطابق مباشرة لواجهة المشغل
    const activeSeasonEpisodes = structuredSeasons[targetSeasonIndex]
      ? structuredSeasons[targetSeasonIndex].episodes
      : formattedEpisodes;

    res.json({
      success: true,
      data: {
        ...anime.toObject(),
        seasonNumber: structuredSeasons[targetSeasonIndex]?.seasonNumber || 1,
        seasonTitle: structuredSeasons[targetSeasonIndex]?.title || anime.seasonTitle,
        defaultSeasonIndex: targetSeasonIndex,
        seasons: structuredSeasons,
        episodes: activeSeasonEpisodes,
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
