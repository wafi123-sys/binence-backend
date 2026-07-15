# Gunakan image Node.js yang ringan (versi 20 Alpine)
FROM node:20-alpine AS builder

WORKDIR /app

# Salin package.json dan package-lock.json (jika ada)
COPY package*.json ./

# Install dependensi secara lengkap (termasuk devDependencies karena Next.js butuh)
RUN npm install

# Salin semua source code ke dalam container
COPY . .

# Lakukan build Next.js
RUN npm run build

# Tahap production untuk meminimalkan ukuran image
FROM node:20-alpine AS runner

WORKDIR /app

# Atur environment ke production
ENV NODE_ENV production
ENV PORT 3000

COPY --from=builder /app ./

EXPOSE 3000

# Eksekusi server kustom kita menggunakan tsx (sama seperti di Railway)
CMD ["npm", "start"]
