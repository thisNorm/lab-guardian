// prisma.config.ts
import { defineConfig } from '@prisma/config';

export default defineConfig({
  // ❌ earlyAccess: true  <-- 이 줄 삭제! (에러 원인)
  
  datasource: {
    // ❌ provider: 'sqlite' <-- 이 줄 삭제! (schema.prisma에 이미 있음)
    
    // ✅ 오직 url만 남깁니다.
    url: 'file:./dev.db',
  },
});