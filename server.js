const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI;

// تهيئة اتصال MongoDB المتوافق مع Serverless (Cached Connection)
let isConnected = false;

const connectDB = async () => {
    if (isConnected) {
        return;
    }
    try {
        const db = await mongoose.connect(MONGO_URI);
        isConnected = db.connections[0].readyState;
        console.log('✅ Connected to MongoDB');
    } catch (err) {
        console.error('❌ Database connection error:', err);
        throw err;
    }
};

// الوسيط لضمان الاتصال بقاعدة البيانات قبل كل طلب
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (error) {
        res.status(500).json({ error: 'Database connection failed' });
    }
});

// تعريف المخططات
const animeSchema = new mongoose.Schema({}, { strict: false });
const Anime = mongoose.models.Anime || mongoose.model('Anime', animeSchema, 'animes');

const episodeSchema = new mongoose.Schema({}, { strict: false });
const Episode = mongoose.models.Episode || mongoose.model('Episode', episodeSchema, 'episodes');

// مسارات الـ API
app.get('/', (req, res) => {
    res.send('Anime API is running live!');
});

// جلب كل الأنميات
app.get('/api/animes', async (req, res) => {
    try {
        const animes = await Anime.find();
        res.json(animes);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch animes' });
    }
});

// جلب تفاصيل أنمي محدد
app.get('/api/animes/:id', async (req, res) => {
    try {
        const anime = await Anime.findById(req.params.id);
        if (!anime) return res.status(404).json({ error: 'Anime not found' });
        res.json(anime);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch anime details' });
    }
});

// جلب حلقات الأنمي
app.get('/api/animes/:id/episodes', async (req, res) => {
    try {
        const episodes = await Episode.find({ animeId: req.params.id }).sort({ seasonNumber: 1, episodeNumber: 1 });
        res.json(episodes);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch episodes' });
    }
});

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
}

module.exports = app;
