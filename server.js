const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// 1. الاتصال بقاعدة البيانات
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected successfully to MongoDB'))
  .catch((err) => console.error('❌ Database connection error:', err));

// 2. نموذج بيانات الأنمي (Anime Schema)
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

// 3. نموذج بيانات الحلقات (مرن ليدعم anime_id أو animeId و sources أو servers)
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
      url: { type: String, required: true }
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
// مسارات الكاتالوغ (Catalog Endpoints)
// ==========================================

// جلب كل الأنميات
app.get('/api/animes', async (req, res) => {
  try {
    const animes = await Anime.find().sort({ createdAt: -1 });
    res.json(animes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch animes' });
  }
});

// ==========================================
// مسار المشغل الرئيسي (المعدل ليربط الأنمي بحلقاته مباشرة)
// ==========================================
app.get('/api/animes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 1. جلب الأنمي
    const anime = await Anime.findById(id);
    if (!anime) {
      return res.status(404).json({ success: false, message: 'Anime not found' });
    }

    // 2. البحث عن الحلقات سواء كانت anime_id أو animeId وكنص أو ObjectId
    let queryConditions = [
      { anime_id: id },
      { animeId: id }
    ];

    if (mongoose.Types.ObjectId.isValid(id)) {
      const objId = new mongoose.Types.ObjectId(id);
      queryConditions.push({ anime_id: objId }, { animeId: objId });
    }

    const rawEpisodes = await Episode.find({ $or: queryConditions }).sort({ seasonNumber: 1, episodeNumber: 1 });

    // 3. توحيد تنسيق الحلقات (sources و subtitles) ليتوافق مع تطبيق الأندرويد تماماً
    const formattedEpisodes = rawEpisodes.map(ep => {
      const epObj = ep.toObject();

      // توحيد مصادر الفيديو
      let sources = epObj.sources || [];
      if (sources.length === 0 && epObj.servers && epObj.servers.length > 0) {
        sources = epObj.servers.map(s => ({
          serverName: s.name || 'Server',
          quality: 'Auto',
          url: s.url
        }));
      }

      // توحيد الترجمات
      let subtitles = epObj.subtitles || [];
      subtitles = subtitles.map(sub => ({
        lang: sub.lang || sub.language || sub.label || 'Arabic',
        url: sub.url
      }));

      return {
        ...epObj,
        title: typeof epObj.title === 'object' ? (epObj.title.ar || epObj.title.en || `الحلقة ${epObj.episodeNumber}`) : (epObj.title || `الحلقة ${epObj.episodeNumber}`),
        sources: sources,
        subtitles: subtitles
      };
    });

    // 4. إرجاع النتيجة بالشكل الذي ينتظره AnimeDetailResponse
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
