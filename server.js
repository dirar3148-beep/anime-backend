const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. إعدادات السيرفرات والترويسات
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
// 3. النماذج المرنة (Flexible Schemas)
// ==========================================
// استخدام strict: false يضمن عدم فشل القراءة مهما اختلف شكل الحقول
const animeSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const episodeSchema = new mongoose.Schema({}, { strict: false, timestamps: true });

const Anime = mongoose.model('Anime', animeSchema, 'animes');
const Episode = mongoose.model('Episode', episodeSchema, 'episodes');

// ==========================================
// 4. مسار الكتالوج العام للمكتبة
// ==========================================
app.get('/api/animes', async (req, res) => {
  try {
    const rawAnimes = await Anime.find().sort({ createdAt: -1 }).lean();

    // توحيد بنية البيانات حتى لا تفشل نماذج Retrofit في تطبيق الأندرويد
    const sanitizedAnimes = rawAnimes.map(item => {
      let titleObj = item.title;
      if (typeof titleObj === 'string') {
        titleObj = { en: titleObj, ar: titleObj };
      } else if (!titleObj) {
        titleObj = { en: 'Unknown Title', ar: 'عنوان غير معروف' };
      }

      return {
        ...item,
        title: titleObj,
        section: item.section || 'popular',
        rating: typeof item.rating === 'number' ? item.rating : 8.0,
        seasonNumber: item.seasonNumber || 1
      };
    });

    res.json(sanitizedAnimes);
  } catch (err) {
    console.error("Error in /api/animes:", err);
    res.status(500).json({ error: 'Failed to fetch animes' });
  }
});

// ==========================================
// 5. مسار المشغل وتفاصيل المواسم
// ==========================================
app.get('/api/animes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    let anime = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      anime = await Anime.findById(id).lean();
    }
    if (!anime) {
      anime = await Anime.findOne({ source_uuid: id }).lean();
    }
    if (!anime) {
      return res.status(404).json({ success: false, message: 'Anime not found' });
    }

    const rawTitle = anime.title?.en || (typeof anime.title === 'string' ? anime.title : '');

    // استخراج اسم السلسلة بدقة تامة وبدون أي خطأ في استعلام Mongo
    let franchiseAnimes = [];

    if (/shippuden/i.test(rawTitle)) {
      // إذا كان ناروتو شيبودن: اجلب كل ما يخص شيبودن فقط
      franchiseAnimes = await Anime.find({
        "title.en": { $regex: /shippuden/i }
      }).lean();
    } else if (/\bnaruto\b/i.test(rawTitle)) {
      // إذا كان ناروتو الكلاسيكي: اجلب أعمال ناروتو مع استبعاد شيبودن من النتائج في الذاكرة بأمان
      const narutoDocs = await Anime.find({
        "title.en": { $regex: /\bnaruto\b/i }
      }).lean();

      franchiseAnimes = narutoDocs.filter(doc => {
        const t = (doc.title?.en || doc.title || '').toString();
        return !/shippuden/i.test(t);
      });
    } else {
      // للأنميات الأخرى مثل Jujutsu Kaisen
      const cleanBase = rawTitle.split(':')[0].replace(/\s*(2nd Season|Season \d+|Part \d+|\(TV\)|-).*/i, '').trim();
      franchiseAnimes = await Anime.find({
        $or: [
          { "title.en": { $regex: new RegExp(`^${cleanBase}`, "i") } },
          { _id: anime._id }
        ]
      }).lean();
    }

    // إذا لم يجد سوى العمل الحالي
    if (!franchiseAnimes || franchiseAnimes.length === 0) {
      franchiseAnimes = [anime];
    }

    const franchiseIds = franchiseAnimes.map(a => a._id.toString());
    const franchiseUuids = franchiseAnimes.map(a => a.source_uuid).filter(Boolean);

    // البحث عن الحلقات بكافة المعرفات المحتملة
    const queryOr = [
      { anime_id: { $in: franchiseIds } },
      { animeId: { $in: franchiseIds } },
      { source_uuid: { $in: franchiseUuids } }
    ];

    if (mongoose.Types.ObjectId.isValid(id)) {
      const objId = new mongoose.Types.ObjectId(id);
      queryOr.push({ anime_id: objId }, { animeId: objId });
    }

    const rawEpisodes = await Episode.find({ $or: queryOr })
      .sort({ seasonNumber: 1, episodeNumber: 1 })
      .lean();

    // تنسيق الحلقات والمصادر
    const formattedEpisodes = rawEpisodes.map(epObj => {
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

      const finalTitle = typeof epObj.title === 'object'
        ? (epObj.title.en || epObj.title.ar || `Episode ${epObj.episodeNumber}`)
        : (epObj.title || `Episode ${epObj.episodeNumber}`);

      return {
        ...epObj,
        title: finalTitle,
        seasonNumber: epObj.seasonNumber || 1,
        seasonTitle: epObj.seasonTitle || `Season ${epObj.seasonNumber || 1}`,
        sources: processedSources,
        subtitles: subtitles
      };
    });

    // تجميع الحلقات داخل مواسم للمشغل
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

    const currentSeasonNum = anime.seasonNumber || 1;
    let targetSeasonIndex = structuredSeasons.findIndex(s => s.seasonNumber === currentSeasonNum);
    if (targetSeasonIndex === -1) targetSeasonIndex = 0;

    res.json({
      success: true,
      data: {
        ...anime,
        seasonNumber: currentSeasonNum,
        defaultSeasonIndex: targetSeasonIndex,
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
