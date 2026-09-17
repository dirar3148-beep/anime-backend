// 1. استخراج الاسم الأساسي
    const rawTitle = anime.title?.en || anime.title || "";
    const cleanBaseTitle = rawTitle
      .split(':')[0]
      .replace(/\s*(2nd Season|Season \d+|Part \d+|\(TV\)|-).*/i, '')
      .trim();

    // 2. بناء شرط بحث ذكي يفصل بين الأجزاء المختلفة (مثل Naruto الكلاسيكي و Shippuden)
    let titleQuery = {};
    const isShippuden = /shippuden/i.test(rawTitle);

    if (isShippuden) {
      // إذا كان الأنمي الحالي هو شيبودن، نبحث فقط عن مواسم شيبودن
      titleQuery = { "title.en": { $regex: /^Naruto Shippuden/i } };
    } else if (/^naruto\b/i.test(cleanBaseTitle)) {
      // إذا كان ناروتو القديم، نأخذ فقط ما يخص ناروتو الكلاسيكي ونستبعد شيبودن تماماً
      titleQuery = { 
        "title.en": { 
          $regex: /^Naruto\b/i, 
          $not: /shippuden/i 
        } 
      };
    } else {
      // لبقية الأنميات (مثل Jujutsu Kaisen أو One Piece)
      titleQuery = { "title.en": { $regex: new RegExp(`^${cleanBaseTitle}(:|$|\\s)`, "i") } };
    }

    const franchiseAnimes = await Anime.find({
      $or: [
        titleQuery,
        { _id: anime._id }
      ]
    });
