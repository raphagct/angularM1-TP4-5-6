import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { OAuth2Client } from 'google-auth-library';
import { User } from '../models/User.js';
import { MagicLink } from './MagicLink.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mailTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
}

async function verifiedGoogleIdentity(credential, clientId) {
  if (typeof credential !== 'string' || credential.length > 8192) return null;
  try {
    const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId });
    const payload = ticket.getPayload();
    return payload?.email_verified && payload.email && payload.sub ? payload : null;
  } catch (error) {
    console.warn('[auth] Identifiant Google refusé', error?.name);
    return null;
  }
}

export function registerAlternateAuth(app, issueToken, auth) {
  app.get('/api/auth/google/config', (_req, res) => {
    res.json({ clientId: process.env.GOOGLE_CLIENT_ID || null });
  });

  app.post('/api/auth/magic/request', async (req, res, next) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!emailPattern.test(email) || email.length > 254) {
        return res.status(400).json({ message: 'Adresse email invalide' });
      }
      const transport = mailTransport();
      if (!transport) return res.status(503).json({ message: 'Envoi d’email non configuré' });
      // Même réponse pour une adresse connue ou inconnue : aucune révélation de compte.
      const response = { message: 'Si ce compte existe, un lien de connexion a été envoyé.' };
      const user = await User.exists({ email });
      if (!user) return res.json(response);
      const recent = await MagicLink.exists({ email, createdAt: { $gt: new Date(Date.now() - 60_000) } });
      if (recent) return res.json(response);
      await MagicLink.deleteMany({ email });
      const raw = crypto.randomBytes(32).toString('base64url');
      const record = await MagicLink.create({
        email, tokenHash: hash(raw), expiresAt: new Date(Date.now() + 10 * 60_000),
      });
      const base = process.env.FRONTEND_URL || 'http://localhost:4200';
      const link = new URL('/magic-link', base);
      link.searchParams.set('token', raw);
      try {
        await transport.sendMail({
          from: process.env.SMTP_FROM, to: email, subject: 'Connexion Guitar Practice Cloud',
          text: `Ce lien de connexion est valable 10 minutes et utilisable une seule fois : ${link.toString()}`,
        });
      } catch (error) {
        await MagicLink.deleteOne({ _id: record.id });
        console.error('[auth] Envoi du lien impossible', error);
        return res.status(503).json({ message: 'Envoi d’email impossible' });
      }
      return res.json(response);
    } catch (error) {
      console.error('[auth] Demande de lien impossible', error);
      next(error);
    }
  });

  app.post('/api/auth/magic/verify', async (req, res, next) => {
    try {
      const raw = req.body?.token;
      if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) {
        return res.status(400).json({ message: 'Lien invalide' });
      }
      const record = await MagicLink.findOneAndDelete({
        tokenHash: hash(raw), expiresAt: { $gt: new Date() },
      });
      if (!record) return res.status(401).json({ message: 'Lien expiré ou déjà utilisé' });
      const user = await User.findOne({ email: record.email });
      if (!user) return res.status(401).json({ message: 'Compte introuvable' });
      return res.json({ token: issueToken(user), user: user.toPublic() });
    } catch (error) {
      console.error('[auth] Validation du lien impossible', error);
      next(error);
    }
  });

  app.post('/api/auth/google', async (req, res, next) => {
    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) return res.status(503).json({ message: 'Connexion Google non configurée' });
      const credential = req.body?.credential;
      if (typeof credential !== 'string' || credential.length > 8192) {
        return res.status(400).json({ message: 'Identifiant Google invalide' });
      }
      const payload = await verifiedGoogleIdentity(credential, clientId);
      if (!payload) return res.status(401).json({ message: 'Connexion Google refusée' });
      const email = payload.email.toLowerCase();
      let user = await User.findOne({ googleSub: payload.sub });
      if (!user) {
        user = await User.findOne({ email });
        if (user) {
          // Ne pas lier silencieusement un compte existant à un autre fournisseur.
          return res.status(409).json({ message: 'Compte existant : connectez-vous avec votre mot de passe ou un lien email.' });
        }
        user = await User.create({ email, name: payload.name || email.split('@')[0], googleSub: payload.sub });
      }
      return res.json({ token: issueToken(user), user: user.toPublic() });
    } catch (error) {
      console.error('[auth] Connexion Google impossible', error);
      next(error);
    }
  });

  app.post('/api/auth/google/link', auth, async (req, res, next) => {
    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) return res.status(503).json({ message: 'Connexion Google non configurée' });
      const payload = await verifiedGoogleIdentity(req.body?.credential, clientId);
      if (!payload) return res.status(401).json({ message: 'Identifiant Google invalide' });
      const user = await User.findById(req.auth.sub);
      if (!user) return res.status(404).json({ message: 'Compte inconnu' });
      if (user.email !== payload.email.toLowerCase()) {
        return res.status(409).json({ message: 'Le compte Google doit utiliser le même email.' });
      }
      const claimed = await User.exists({ googleSub: payload.sub, _id: { $ne: user._id } });
      if (claimed) return res.status(409).json({ message: 'Ce compte Google est déjà associé.' });
      user.googleSub = payload.sub;
      await user.save();
      return res.json({ user: user.toPublic() });
    } catch (error) {
      console.error('[auth] Association Google impossible', error);
      next(error);
    }
  });
}
