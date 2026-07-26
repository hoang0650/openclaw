const fs = require('fs');
const path = './openclaw.json';

try {
  if (fs.existsSync(path)) {
    const config = JSON.parse(fs.readFileSync(path, 'utf8'));

    // 1. Lấy chuỗi biến môi trường (ví dụ: "https://a.phhotel.vn, https://b.phhotel.vn")
    const rawOrigins = process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '';

    // 2. Tách chuỗi thành mảng, loại bỏ khoảng trắng thừa và bỏ phần tử rỗng
    const newOrigins = rawOrigins
      .split(',')
      .map(origin => origin.trim())
      .filter(origin => origin.length > 0);

    if (newOrigins.length > 0) {
      // 3. Lấy mảng allowedOrigins hiện tại trong openclaw.json
      const currentOrigins = config.gateway?.controlUi?.allowedOrigins || [];

      // 4. Gộp mảng cũ và mảng mới, tự động xóa bỏ trùng lặp (Set)
      const mergedOrigins = Array.from(new Set([...currentOrigins, ...newOrigins]));

      // 5. Cập nhật lại vào object config
      if (!config.gateway) config.gateway = {};
      if (!config.gateway.controlUi) config.gateway.controlUi = {};
      config.gateway.controlUi.allowedOrigins = mergedOrigins;

      // 6. Ghi đè file openclaw.json
      fs.writeFileSync(path, JSON.stringify(config, null, 2));
      console.log(`✅ Đã cập nhật thành công ${newOrigins.length} domain vào allowedOrigins:`);
      console.log(newOrigins);
    } else {
      console.log('ℹ️ Không phát hiện biến môi trường ALLOWED_ORIGINS mới.');
    }
  }
} catch (error) {
  console.error('❌ Lỗi khi cập nhật openclaw.json:', error);
}