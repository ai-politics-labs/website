// 피해 유형 (PRD 8.3)
export interface IncidentType {
  code: string;
  label: string;
}

export const INCIDENT_TYPES: IncidentType[] = [
  { code: "BALLOT_SHORTAGE", label: "투표용지 부족 안내를 받음" },
  { code: "VOTING_PAUSED", label: "투표가 일시 중단됨" },
  { code: "LONG_WAIT", label: "장시간 대기" },
  { code: "LEFT_WITHOUT_VOTING", label: "기다리다 귀가함" },
  { code: "VOTED_AFTER_CLOSE", label: "공식 종료시간 이후 투표" },
  { code: "INSUFFICIENT_GUIDANCE", label: "현장 설명이 불충분했음" },
  { code: "MOVED_TO_OTHER_PLACE", label: "다른 장소 이동 안내를 받음" },
  { code: "BALLOT_BOX_ISSUE", label: "투표함 이동·보관 관련 문제를 목격함" },
  { code: "OTHER", label: "기타" },
];

export const INCIDENT_LABEL: Record<string, string> = Object.fromEntries(
  INCIDENT_TYPES.map((t) => [t.code, t.label]),
);

// 제보 상태값 (PRD 8.8)
export const REPORT_STATUSES = [
  { code: "SUBMITTED", label: "접수됨" },
  { code: "UNDER_REVIEW", label: "검토 중" },
  { code: "NEEDS_MORE_INFO", label: "추가 확인 필요" },
  { code: "DUPLICATE", label: "중복 제보" },
  { code: "VERIFIED", label: "확인됨" },
  { code: "REJECTED", label: "반려" },
  { code: "LEGAL_REVIEW", label: "법률 검토 대상" },
  { code: "ARCHIVED", label: "보관 처리" },
] as const;

export const REPORT_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  REPORT_STATUSES.map((s) => [s.code, s.label]),
);

export const LEGAL_PRIORITIES = [
  { code: "HIGH", label: "높음" },
  { code: "MEDIUM", label: "중간" },
  { code: "LOW", label: "낮음" },
] as const;
