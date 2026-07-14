// Shared row <-> frontend-object mapping for `workflow_instances`.

function rowToWfInstance(row) {
  return {
    id: row.id,
    type: row.type,
    entityId: row.entity_id,
    entityName: row.entity_name,
    entityType: row.entity_type,
    createdAt: row.created_at,
    createdBy: row.created_by,
    currentStep: row.current_step,
    status: row.status,
    steps: JSON.parse(row.steps_json || '[]'),
  };
}

const INSERT_SQL = `
  INSERT INTO workflow_instances
    (tenant_id, type, entity_id, entity_name, entity_type, created_at, created_by, current_step, status, steps_json)
  VALUES
    (@tenantId, @type, @entityId, @entityName, @entityType, @createdAt, @createdBy, @currentStep, @status, @stepsJson)
`;

const UPDATE_SQL = `
  UPDATE workflow_instances SET
    current_step=@currentStep, status=@status, steps_json=@stepsJson
  WHERE id=@id AND tenant_id=@tenantId
`;

// For seed.js — turns a plain demo-data object (see WORKFLOW_INSTANCES)
// into INSERT_SQL params.
function wfInstanceToParams(w) {
  return {
    type: w.type,
    entityId: w.entityId != null ? w.entityId : null,
    entityName: w.entityName,
    entityType: w.entityType,
    createdAt: w.createdAt,
    createdBy: w.createdBy,
    currentStep: w.currentStep,
    status: w.status,
    stepsJson: JSON.stringify(w.steps),
  };
}

module.exports = { rowToWfInstance, wfInstanceToParams, INSERT_SQL, UPDATE_SQL };
