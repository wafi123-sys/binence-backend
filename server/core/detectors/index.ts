import { FeatureSnapshot, MarketState, CandidateEvent, RawTrade } from '../types';

export interface Detector {
  evaluate(features: FeatureSnapshot, state: MarketState, trade?: RawTrade): CandidateEvent[];
}
