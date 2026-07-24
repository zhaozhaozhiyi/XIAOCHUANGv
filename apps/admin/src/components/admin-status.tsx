import { AdminChip } from "@/components/admin-kit";

function buildStatusMeta<TTone extends "accent" | "success" | "warning" | "danger" | "muted">(label: string, tone: TTone) {
  return { label, tone };
}

export function userRoleMeta(role: string) {
  if (role === "super_admin") return buildStatusMeta("超级管理员", "warning");
  if (role === "admin") return buildStatusMeta("管理员", "accent");
  if (role === "user") return buildStatusMeta("用户", "muted");
  return buildStatusMeta(role, "muted");
}

export function userStatusMeta(status: string) {
  if (status === "active") return buildStatusMeta("正常", "success");
  if (status === "disabled") return buildStatusMeta("禁用", "danger");
  return buildStatusMeta(status, "muted");
}

export function subscriptionStatusMeta(status: string) {
  if (status === "active") return buildStatusMeta("有效", "success");
  if (status === "cancelled") return buildStatusMeta("已取消", "danger");
  if (status === "expired") return buildStatusMeta("已过期", "warning");
  return buildStatusMeta(status, "muted");
}

export function dramaStatusMeta(status: string) {
  if (status === "published") return buildStatusMeta("已发布", "success");
  if (status === "draft") return buildStatusMeta("草稿", "muted");
  return buildStatusMeta(status, "warning");
}

export function reviewStatusMeta(status: string | null) {
  if (status === "approved") return buildStatusMeta("已通过", "success");
  if (status === "rejected") return buildStatusMeta("已驳回", "danger");
  if (status === "pending" || !status) return buildStatusMeta("待审核", "warning");
  return buildStatusMeta(status, "muted");
}

export function UserRoleChip({ role }: { role: string }) {
  const meta = userRoleMeta(role);
  return <AdminChip tone={meta.tone}>{meta.label}</AdminChip>;
}

export function UserStatusChip({ status }: { status: string }) {
  const meta = userStatusMeta(status);
  return <AdminChip tone={meta.tone}>{meta.label}</AdminChip>;
}

export function SubscriptionStatusChip({ status }: { status: string }) {
  const meta = subscriptionStatusMeta(status);
  return <AdminChip tone={meta.tone}>{meta.label}</AdminChip>;
}

export function DramaStatusChip({ status }: { status: string }) {
  const meta = dramaStatusMeta(status);
  return <AdminChip tone={meta.tone}>{meta.label}</AdminChip>;
}

export function ReviewStatusChip({ status }: { status: string | null }) {
  const meta = reviewStatusMeta(status);
  return <AdminChip tone={meta.tone}>{meta.label}</AdminChip>;
}
