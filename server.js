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
    enum: ['trending', 'new_releases', 'continue_watching'],
    default: 'new_releases'
  },
  status: { type: String, default: 'Ongoing' }
}, { timestamps: true });

// 3. نموذج بيانات الحلقات (Episode Schema)
const episodeSchema = new mongoose.Schema({
  animeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Anime', required: true },
  seasonNumber: { type: Number, required: true, default: 1 },
  episodeNumber: { type: Number, required: true },
  title: {
    en: { type: String },
    ar: { type: String }
  },
  servers: [
    {
      name: { type: String, required: true },
      url: { type: String, required: true },
      type: { type: String, default: 'm3u8' } // m3u8 or mp4
    }
  ],
  subtitles: [
    {
      label: { type: String, required: true },
      language: { type: String, required: true },
      url: { type: String, required: true } // .vtt file url
    }
  ]
}, { timestamps: true });

const Anime = mongoose.model('Anime', animeSchema);
const Episode = mongoose.model('Episode', episodeSchema);

// ==========================================
// 4. مسارات الكاتالوغ (Catalog Endpoints)
// ==========================================

// جلب كل الأنميات للكاتالوغ الرئيسي
app.get('/api/animes', async (req, res) => {
  try {
    const animes = await Anime.find().sort({ createdAt: -1 });
    res.json(animes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch animes' });
  }
});

// جلب تفاصيل أنمي محدد لشاشة العرض الكبيرة
app.get('/api/animes/:id', async (req, res) => {
  try {
    const anime = await Anime.findById(req.params.id);
    if (!anime) return res.status(404).json({ error: 'Anime not found' });
    res.json(anime);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch anime details' });
  }
});

// ==========================================
// 5. مسارات المشغل (Player Endpoints)
// ==========================================

// جلب جميع حلقات ومواسم أنمي معين مرتبة للمشغل
app.get('/api/animes/:id/episodes', async (req, res) => {
  try {
    const episodes = await Episode.find({ animeId: req.params.id })
      .sort({ seasonNumber: 1, episodeNumber: 1 });
    res.json(episodes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch episodes' });
  }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});