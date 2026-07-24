import { createHash } from "node:crypto";

import { BadRequestException, Inject, Injectable } from "@nestjs/common";

import { SkillsService } from "../skills/skills.service";
import type { SkillManifestEntry } from "./agent-runtime.types";

const SKILL_REF_PATTERN =
  /^([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)@([A-Za-z0-9._-]+)$/;

@Injectable()
export class SkillManifestService {
  constructor(
    @Inject(SkillsService) private readonly skillsService: SkillsService,
  ) {}

  async resolve(
    skillRefs: string[],
    expectedManifest: Array<{ ref: string; sha256: string }>,
  ): Promise<SkillManifestEntry[]> {
    const uniqueRefs = [
      ...new Set(skillRefs.map((ref) => ref.trim()).filter(Boolean)),
    ];
    if (!uniqueRefs.length)
      throw new BadRequestException("agent_runtime_skill_refs_required");

    const expectedHashes = new Map(
      expectedManifest.map((item) => [item.ref, item.sha256]),
    );
    return uniqueRefs.map((ref) => {
      const match = ref.match(SKILL_REF_PATTERN);
      if (!match)
        throw new BadRequestException(`agent_runtime_invalid_skill_ref:${ref}`);

      const [, id, version] = match;
      const content = this.skillsService.getSkillContent(id.split("/"));
      const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
      if (expectedHashes.get(ref) !== sha256) {
        throw new BadRequestException(
          `agent_runtime_skill_hash_mismatch:${ref}`,
        );
      }
      return {
        ref,
        id,
        version,
        sha256,
      };
    });
  }
}
