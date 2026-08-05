/**
 * 知识数据访问边界。
 *
 * 当前：通过 knowledge-service 访问 public/data/knowledge.json（支持运行时热更新）。
 * 未来可替换为 KV / D1 / 外部检索服务，无需修改检索层代码。
 */
import type { OfficialSource } from "./types";
import { getAllSources, findSourcesByIds } from "./knowledge-service";

export interface KnowledgeRepository {
  getAll(): readonly OfficialSource[];
  findByIds(ids: readonly string[]): readonly OfficialSource[];
}

class KnowledgeServiceRepository implements KnowledgeRepository {
  getAll(): readonly OfficialSource[] {
    return getAllSources();
  }

  findByIds(ids: readonly string[]): readonly OfficialSource[] {
    return findSourcesByIds(ids);
  }
}

export const knowledgeRepository: KnowledgeRepository = new KnowledgeServiceRepository();
