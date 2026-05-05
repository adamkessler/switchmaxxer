export type SqlWhereValue = string | number;

export type WhereClauseCondition = {
  clause: string;
  values: readonly SqlWhereValue[];
};

export type BuiltWhereClause = {
  whereClause: string;
  values: SqlWhereValue[];
};

type OptionalWhereClauseCondition = WhereClauseCondition | false | null | undefined;

function countBindPlaceholders(clause: string): number {
  let count = 0;

  for (const character of clause) {
    if (character === "?") {
      count += 1;
    }
  }

  return count;
}

function assertValidWhereCondition(condition: WhereClauseCondition): void {
  if (condition.clause.trim().length === 0) {
    throw new Error("WHERE condition clause must be a non-empty SQL fragment.");
  }

  const placeholderCount = countBindPlaceholders(condition.clause);

  if (placeholderCount !== condition.values.length) {
    throw new Error(
      `WHERE condition '${condition.clause}' has ${placeholderCount} placeholder(s) but ${condition.values.length} value(s).`
    );
  }
}

export function whereNonEmptyString(
  clause: string,
  value: string | null | undefined,
  bindValues: (value: string) => readonly SqlWhereValue[] = (presentValue) => [presentValue]
): WhereClauseCondition | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return {
    clause,
    values: bindValues(value)
  };
}

export function buildWhereClause(conditions: readonly OptionalWhereClauseCondition[]): BuiltWhereClause {
  const clauses: string[] = [];
  const values: SqlWhereValue[] = [];

  for (const condition of conditions) {
    if (!condition) {
      continue;
    }

    assertValidWhereCondition(condition);
    clauses.push(condition.clause);
    values.push(...condition.values);
  }

  return {
    whereClause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    values
  };
}
