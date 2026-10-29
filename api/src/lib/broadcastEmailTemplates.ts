/**
 * broadcastEmailTemplates.ts — reusable templates for Admin > Broadcast Email.
 *
 * A template just pre-fills the composer (subject/body/CTA); it has no audience or
 * schedule of its own. Separate from `broadcast_campaigns`, which records actual sends.
 */

import { ObjectId } from "mongodb";
import clientPromise from "./mongodb";
import { COLLECTIONS } from "./db";

export type BroadcastBodyMode = "text" | "html";

export interface BroadcastEmailTemplate {
  _id?: ObjectId;
  name: string;
  subject: string;
  bodyMode: BroadcastBodyMode;
  bodyText: string | null;
  bodyHtml: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function templatesCollection() {
  return clientPromise.then((client) => client.db().collection<BroadcastEmailTemplate>(COLLECTIONS.BROADCAST_EMAIL_TEMPLATES));
}

function serializeTemplate(doc: BroadcastEmailTemplate & { _id?: ObjectId }) {
  return { ...doc, _id: doc._id?.toString?.() || String(doc._id) };
}

export async function listBroadcastEmailTemplates() {
  const col = await templatesCollection();
  const docs = await col.find({}).sort({ updatedAt: -1 }).limit(200).toArray();
  return docs.map(serializeTemplate);
}

export async function getBroadcastEmailTemplate(id: string) {
  if (!ObjectId.isValid(id)) return null;
  const col = await templatesCollection();
  const doc = await col.findOne({ _id: new ObjectId(id) });
  return doc ? serializeTemplate(doc) : null;
}

export interface SaveBroadcastEmailTemplateInput {
  name: string;
  subject: string;
  bodyMode: BroadcastBodyMode;
  bodyText?: string | null;
  bodyHtml?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
}

export async function createBroadcastEmailTemplate(input: SaveBroadcastEmailTemplateInput, adminUserId: string) {
  const col = await templatesCollection();
  const now = new Date().toISOString();
  const doc: BroadcastEmailTemplate = {
    name: input.name,
    subject: input.subject,
    bodyMode: input.bodyMode,
    bodyText: input.bodyMode === "text" ? input.bodyText || "" : null,
    bodyHtml: input.bodyMode === "html" ? input.bodyHtml || "" : null,
    ctaLabel: input.ctaLabel || null,
    ctaUrl: input.ctaUrl || null,
    createdBy: adminUserId,
    createdAt: now,
    updatedAt: now,
  };
  const result = await col.insertOne(doc as BroadcastEmailTemplate & { _id?: ObjectId });
  return serializeTemplate({ ...doc, _id: result.insertedId });
}

export async function updateBroadcastEmailTemplate(id: string, input: SaveBroadcastEmailTemplateInput) {
  if (!ObjectId.isValid(id)) return null;
  const col = await templatesCollection();
  const now = new Date().toISOString();
  const update = {
    name: input.name,
    subject: input.subject,
    bodyMode: input.bodyMode,
    bodyText: input.bodyMode === "text" ? input.bodyText || "" : null,
    bodyHtml: input.bodyMode === "html" ? input.bodyHtml || "" : null,
    ctaLabel: input.ctaLabel || null,
    ctaUrl: input.ctaUrl || null,
    updatedAt: now,
  };
  const result = await col.findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: update },
    { returnDocument: "after" }
  );
  return result ? serializeTemplate(result) : null;
}

export async function deleteBroadcastEmailTemplate(id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const col = await templatesCollection();
  const result = await col.deleteOne({ _id: new ObjectId(id) });
  return result.deletedCount > 0;
}
