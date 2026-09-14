# دليل نشر TaskMaster Backend

## الخطوة 1: إنشاء حساب على GitHub
1. اذهب إلى https://github.com
2. أنشئ حساب مجاني
3. أنشئ repository جديد باسم `taskmaster-backend`

## الخطوة 2: رفع الملفات
1. افتح terminal في مجلد `backend`
2. نفذ الأوامر:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/taskmaster-backend.git
git push -u origin main
```

## الخطوة 3: النشر على Railway
1. اذهب إلى https://railway.app
2. سجل الدخول بحساب GitHub
3. اضغط "New Project"
4. اختر "Deploy from GitHub repo"
5. اختر repository `taskmaster-backend`
6. Railway سيقوم تلقائياً بـ:
   - تثبيت المكتبات
   - تشغيل السيرفر
   - إنشاء الجداول في SQL Server

## الخطوة 4: الحصول على الرابط
1. بعد النشر، ستحصل على رابط مثل:
   `https://taskmaster-api-production.up.railway.app`
2. انسخ هذا الرابط

## الخطوة 5: تحديث التطبيق
1. افتح ملف `lib/services/api_service.dart`
2. غيّر `baseUrl` إلى الرابط الجديد:

```dart
static const String baseUrl = 'https://your-app-name.up.railway.app/api';
```

## الخطوة 6: إعادة بناء التطبيق
```bash
flutter build apk --release
```

## اختبار الاتصال
1. شغّل التطبيق
2. سجّل حساب جديد
3. تحقق من البيانات في SQL Server

## ملاحظات
- Railway مجاني لـ 500 ساعة شهرياً
- السيرفر يشتغل 24/7
- الجداول تُنشأ تلقائياً عند أول تشغيل
- إذا لم تُنشأ الجداول، أعد تشغيل السيرفر
