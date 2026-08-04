import { OFFICIAL_SOURCES } from "./knowledge";
import type { OfficialSource } from "./types";

/**
 * 知识数据访问边界。当前实现完全在内存中，未来迁移 KV / D1 / 外部检索
 * 服务时可替换实现，而无需把数据库查询细节扩散到检索与 API 层。
 */
export interface KnowledgeRepository {
  getAll(): readonly OfficialSource[];
  findByIds(ids: readonly string[]): readonly OfficialSource[];
}

class StaticKnowledgeRepository implements KnowledgeRepository {
  private readonly sourcesById = new Map(OFFICIAL_SOURCES.map((source) => [source.id, source]));

  getAll(): readonly OfficialSource[] {
    return OFFICIAL_SOURCES;
  }

  findByIds(ids: readonly string[]): readonly OfficialSource[] {
    return Object.freeze(ids.flatMap((id) => {
      const source = this.sourcesById.get(id);
      return source ? [source] : [];
    }));
  }
}

export const knowledgeRepository: KnowledgeRepository = new StaticKnowledgeRepository();
