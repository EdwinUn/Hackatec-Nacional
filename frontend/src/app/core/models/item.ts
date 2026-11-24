// Refleja /items en API.md (recurso de ejemplo)
export interface Item {
  id: number;
  name: string;
  created_at: string;
}

export interface ItemCreate {
  name: string;
}
