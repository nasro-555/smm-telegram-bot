# SMM Telegram Bot Starter

نسخه پایه برای:
- Railway
- Node.js
- Telegraf
- PostgreSQL

## قابلیت‌های فعلی

- `/start`
- منوی اصلی
- ایجاد سفارش جدید
- قیمت بسته‌ها
- انتخاب پلتفرم
- انتخاب دسته خدمات
- نمایش دکمه‌های Service Option به‌صورت Dynamic از دیتابیس
- نمایش بسته‌ها و قیمت‌های متفاوت
- دریافت لینک سفارش
- تأیید سفارش
- بررسی موجودی
- ثبت سفارش در PostgreSQL
- سفارش‌های من
- موجودی من
- پشتیبانی

اتصال واقعی سفارش به API Provider هنوز عمداً اضافه نشده و در مرحله بعد انجام می‌شود.

## پلتفرم‌های Seed شده

- Instagram
- Facebook
- TikTok
- YouTube
- Telegram
- Twitter / X
- WhatsApp
- Kik
- Threads
- LinkedIn
- Google Maps
- Likee
- Snapchat

## Railway Variables

در سرویس Railway این متغیرها را داشته باشید:

```env
BOT_TOKEN=...
DATABASE_URL=${{Postgres.DATABASE_URL}}
SUPPORT_USERNAME=@YourSupportUsername
```

`SUPPORT_USERNAME` اختیاری است.

## Deploy روی Railway

1. این پروژه را داخل یک GitHub Repository آپلود کنید.
2. در Railway وارد سرویس `SMM-Telegram-Bot` شوید.
3. Settings → Source → Connect Repo
4. Repository را انتخاب کنید.
5. Railway به‌طور خودکار `npm install` و سپس `npm start` را اجرا می‌کند.
6. در Deploy Logs باید این دو خط را ببینید:

```text
Database initialized.
Starting Telegram bot...
```

بعد در Telegram برای ربات `/start` بفرستید.

## تست دکمه‌های Provider

در نسخه اولیه هنوز هیچ Service Option واقعی وجود ندارد، بنابراین وقتی وارد مثلاً:

Instagram → فالوور

می‌شوید، پیام «هنوز سرویسی اضافه نشده» می‌بینید.

برای تست رابط کاربری می‌توانید `sql/example-data.sql` را روی PostgreSQL اجرا کنید. این فقط داده آزمایشی است.

## ساختار چند Provider

هر Provider یک رکورد در جدول `providers` دارد.

هر دکمه‌ای که مشتری زیر «فالوور»، «لایک»، «ویو» و غیره می‌بیند، یک رکورد در `service_options` است و می‌تواند به Provider متفاوتی وصل باشد.

بنابراین مثلاً:

- فالوور اقتصادی → Provider 1
- فالوور سریع → Provider 4
- فالوور باکیفیت → Provider 7

و هرکدام بسته‌ها و قیمت‌های مستقل خودشان را دارند.

## مرحله بعد

برای اتصال Provider واقعی، برای هر سایت این اطلاعات لازم خواهد بود:

- نام سایت / Provider
- API URL
- API documentation یا نمونه Request
- Service ID
- نام دکمه‌ای که مشتری باید ببیند
- حداقل و حداکثر
- بسته‌ها و قیمت فروش

API Keyها باید فقط داخل Railway Variables یا یک secret store قرار بگیرند، نه داخل GitHub.
