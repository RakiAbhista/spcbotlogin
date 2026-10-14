require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const mineflayer = require('mineflayer');

const PREFIX = '-';
const AUTH = process.env.AUTH_MODE || 'offline';

// ---------- Penyimpanan username (file JSON sederhana) ----------
const DB_FILE = './users.json';
const db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : {};
const saveDb = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// ---------- Sesi aktif: discordId -> { bot, host } ----------
const sessions = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

// ---------- Helper ----------
const stripColor = (t) => t.replace(/§./g, '');

async function send(target, text) {
  // Discord maksimal 2000 karakter, jadi dipotong per 1900
  for (let i = 0; i < text.length; i += 1900) {
    try {
      await target.send({
        content: text.slice(i, i + 1900),
        allowedMentions: { parse: [] }, // cegah @everyone / @here
      });
    } catch (err) {
      console.error('Gagal mengirim pesan:', err.message);
    }
  }
}

const HELP = `**Command bot** (prefix \`-\`)
\`-u <nama>\`  simpan username Minecraft
\`-j <ip[:port]>\`  join server
\`-c <pesan>\`  kirim chat
\`-x <command>\`  jalankan command in-game (tanpa /)
\`-l\`  keluar dari server
\`-s\`  status bot
\`-p\`  daftar pemain online
\`-h\`  bantuan`;

// ---------- Handler command ----------
client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;

  const [cmd, ...args] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const rest = args.join(' ');
  const id = msg.author.id;
  const session = sessions.get(id);

  switch (cmd.toLowerCase()) {
    case 'h':
      return msg.reply(HELP);

    case 'u':
      if (!rest) return msg.reply('Contoh: `-u raki`');
      db[id] = args[0];
      saveDb();
      return msg.reply(`✅ Username disimpan: **${args[0]}**`);

    case 'j': {
      if (!db[id]) return msg.reply('Set username dulu: `-u <nama>`');
      if (session) return msg.reply('Kamu masih terhubung. Pakai `-l` dulu.');
      if (!rest) return msg.reply('Contoh: `-j mc.hypixel.net`');

      const [host, port] = args[0].split(':');
      
      try {
        await msg.author.send(`⏳ Menghubungkan ke **${host}** sebagai **${db[id]}**...`);
        if (msg.guild) {
          await msg.reply('Cek DM kamu untuk melanjutkan! 📩');
        }
      } catch (err) {
        return msg.reply('❌ Gagal mengirim DM! Pastikan pengaturan privasi kamu mengizinkan DM dari server ini.');
      }

      const bot = mineflayer.createBot({
        host,
        port: port ? parseInt(port) : 25565,
        username: db[id],
        auth: AUTH,
        profilesFolder: `./auth/${id}`, // cache login Microsoft per user
        onMsaCode: (data) =>
          msg.author.send(
            `🔐 Login Microsoft: buka ${data.verification_uri} lalu masukkan kode \`${data.user_code}\``
          ),
      });

      sessions.set(id, { bot, host });

      bot.once('spawn', () => send(msg.author, `✅ Berhasil join **${host}**`));

      // Teruskan chat server ke Discord
      bot.on('messagestr', (text, position) => {
        if (position === 'game_info') return; // abaikan actionbar
        const clean = stripColor(text).trim();
        if (clean) send(msg.author, `\`[MC]\` ${clean}`);
      });

      bot.on('kicked', (reason) => {
        let r = reason;
        try { r = stripColor(JSON.stringify(JSON.parse(reason))); } catch {}
        send(msg.author, `🥾 Kena kick: ${r}`);
      });

      bot.on('error', (err) => send(msg.author, `⚠️ Error: ${err.message}`));

      bot.on('end', () => {
        sessions.delete(id);
        send(msg.author, '🔌 Terputus dari server.');
      });
      return;
    }

    case 'c':
      if (!session) return msg.reply('Kamu belum join server. Pakai `-j`.');
      if (!rest) return msg.reply('Contoh: `-c haloo`');
      session.bot.chat(rest.slice(0, 256)); // batas chat Minecraft 256 karakter
      if (msg.guild) msg.delete().catch(() => {});
      return msg.author.send('✅ Pesan terkirim: `' + rest.slice(0, 50) + '...`').catch(() => {});

    case 'x':
      if (!session) return msg.reply('Kamu belum join server. Pakai `-j`.');
      if (!rest) return msg.reply('Contoh: `-x lobby`');
      session.bot.chat('/' + rest.replace(/^\//, ''));
      if (msg.guild) msg.delete().catch(() => {});
      return msg.author.send('✅ Command dijalankan: `/' + rest.split(' ')[0] + ' ...`').catch(() => {});

    case 'l':
      if (!session) return msg.reply('Kamu tidak sedang terhubung.');
      session.bot.quit();
      return;

    case 's': {
      if (!session) return msg.reply('🔴 Offline.');
      const b = session.bot;
      const p = b.entity?.position;
      return msg.reply(
        `🟢 Online di **${session.host}**\n` +
        `Ping: ${b.player?.ping ?? '?'} ms | HP: ${Math.round(b.health)} | Lapar: ${b.food}\n` +
        (p ? `Posisi: ${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}` : '')
      );
    }

    case 'p': {
      if (!session) return msg.reply('Kamu belum join server.');
      const names = Object.keys(session.bot.players);
      return msg.reply(`👥 **${names.length}** pemain:\n${names.join(', ')}`.slice(0, 1900));
    }
  }
});

client.once('clientReady', () => console.log(`Bot aktif sebagai ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);