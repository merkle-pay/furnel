# The Challenge: Temporal-Based Stablecoin Payment Flow

Build a Temporal workflow that orchestrates USD → USDC → local currency payments with detailed state tracking.

## Requirements

- **Workflow Design:** Decompose USD collection → USDC minting → local currency offramp into granular activities
- **Database Design:** Model payment states, transactions, fees, FX rates with proper schemas and indexes
- **Compensation:** Implement proper rollback with state transitions
- **Temporal Patterns:** Show child workflows, signals, queries, and saga patterns
- **State Management:** Handle partial failures and reconciliation

## Deliverables

- Temporal workflows with granular activity decomposition
- Database schema with migrations (PostgreSQL preferred)
- Simple API to trigger workflows
- README explaining design decisions
- Notes on handling $10M+ daily volume

## Evaluation Criteria

- Workflow decomposition and boundaries
- Database schema design (normalization, indexes, constraints)
- Understanding of payment state transitions
- Temporal best practices and patterns
- Code quality and AI tool usage
