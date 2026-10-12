use serde::Serialize;
use wasm_bindgen::prelude::*;

const MIN_INSTRUMENT_COUNT: u32 = 1;
const MAX_INSTRUMENT_COUNT: u32 = 50;
const MIN_BATCH_SIZE: u32 = 1;
const MAX_BATCH_SIZE: u32 = 1_000;
const MIN_PRICE_CENTS: i64 = 1_000;
const MAX_PRICE_MOVEMENT_CENTS: i64 = 100;
const PREFERRED_SYMBOLS: [&str; 5] = ["ALFA", "BETA", "GAMMA", "DELTA", "EPSI"];

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarketUpdate {
    instrument: String,
    price_cents: i64,
    trade_quantity: u32,
    bid_cents: i64,
    ask_cents: i64,
    bid_quantity: u32,
    ask_quantity: u32,
}

struct SeededRandom {
    state: u64,
}

impl SeededRandom {
    fn new(seed: u32) -> Self {
        Self {
            state: u64::from(seed),
        }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut value = self.state;
        value = (value ^ (value >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        value ^ (value >> 31)
    }

    fn range_inclusive(&mut self, minimum: u64, maximum: u64) -> u64 {
        debug_assert!(minimum <= maximum);
        minimum + self.next_u64() % (maximum - minimum + 1)
    }
}

fn validate_instrument_count(instrument_count: f64) -> Result<(), &'static str> {
    if !instrument_count.is_finite()
        || instrument_count.fract() != 0.0
        || !(MIN_INSTRUMENT_COUNT as f64..=MAX_INSTRUMENT_COUNT as f64).contains(&instrument_count)
    {
        return Err("instrumentCount must be an integer from 1 to 50");
    }

    Ok(())
}

fn validate_batch_count(count: f64) -> Result<(), &'static str> {
    if !count.is_finite()
        || count.fract() != 0.0
        || !(MIN_BATCH_SIZE as f64..=MAX_BATCH_SIZE as f64).contains(&count)
    {
        return Err("count must be an integer from 1 to 1000");
    }

    Ok(())
}

#[wasm_bindgen]
pub struct MarketGenerator {
    instruments: Vec<String>,
    prices_cents: Vec<i64>,
    next_instrument: usize,
    random: SeededRandom,
}

#[wasm_bindgen]
impl MarketGenerator {
    #[wasm_bindgen(constructor)]
    pub fn new(instrument_count: f64, seed: u32) -> Result<MarketGenerator, JsValue> {
        validate_instrument_count(instrument_count).map_err(JsValue::from_str)?;
        let instrument_count = instrument_count as u32;

        let instruments = (0..instrument_count)
            .map(symbol_for_index)
            .collect::<Vec<_>>();
        let mut random = SeededRandom::new(seed);
        let prices_cents = (0..instrument_count)
            .map(|_| random.range_inclusive(10_000, 100_000) as i64)
            .collect();

        Ok(Self {
            instruments,
            prices_cents,
            next_instrument: 0,
            random,
        })
    }

    pub fn generate_batch(&mut self, count: f64) -> Result<String, JsValue> {
        validate_batch_count(count).map_err(JsValue::from_str)?;
        let count = count as u32;

        let mut updates = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let instrument_index = self.next_instrument;
            self.next_instrument = (self.next_instrument + 1) % self.instruments.len();

            let movement = self
                .random
                .range_inclusive(0, (MAX_PRICE_MOVEMENT_CENTS * 2) as u64)
                as i64
                - MAX_PRICE_MOVEMENT_CENTS;
            let price_cents = (self.prices_cents[instrument_index] + movement).max(MIN_PRICE_CENTS);
            self.prices_cents[instrument_index] = price_cents;

            let spread_cents = self.random.range_inclusive(1, 5) as i64;
            let is_ask_trade = self.random.range_inclusive(0, 1) == 1;
            let (bid_cents, ask_cents) = if is_ask_trade {
                (price_cents - spread_cents, price_cents)
            } else {
                (price_cents, price_cents + spread_cents)
            };

            updates.push(MarketUpdate {
                instrument: self.instruments[instrument_index].clone(),
                price_cents,
                trade_quantity: self.random.range_inclusive(1, 1_000) as u32,
                bid_cents,
                ask_cents,
                bid_quantity: self.random.range_inclusive(0, 10_000) as u32,
                ask_quantity: self.random.range_inclusive(0, 10_000) as u32,
            });
        }

        serde_json::to_string(&updates)
            .map_err(|error| JsValue::from_str(&format!("Failed to serialize updates: {error}")))
    }

    pub fn get_instruments(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.instruments).map_err(|error| {
            JsValue::from_str(&format!("Failed to serialize instruments: {error}"))
        })
    }
}

fn symbol_for_index(index: u32) -> String {
    if let Some(symbol) = PREFERRED_SYMBOLS.get(index as usize) {
        return (*symbol).to_owned();
    }

    format!("INST{:02}", index + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn updates(generator: &mut MarketGenerator, count: u32) -> Vec<Value> {
        serde_json::from_str(&generator.generate_batch(count as f64).unwrap()).unwrap()
    }

    #[test]
    fn generates_requested_batch_sizes_and_market_update_fields() {
        let mut generator = MarketGenerator::new(5.0, 7).unwrap();
        for count in [1, 100, 1_000] {
            let batch = updates(&mut generator, count);
            assert_eq!(batch.len(), count as usize);

            for update in batch {
                let fields = update.as_object().unwrap();
                assert_eq!(fields.len(), 7);
                for field in [
                    "instrument",
                    "priceCents",
                    "tradeQuantity",
                    "bidCents",
                    "askCents",
                    "bidQuantity",
                    "askQuantity",
                ] {
                    assert!(fields.contains_key(field), "missing field {field}");
                }
            }
        }
    }

    #[test]
    fn generated_updates_obey_market_invariants() {
        let mut generator = MarketGenerator::new(5.0, 12).unwrap();
        for update in updates(&mut generator, 1_000) {
            let price = update["priceCents"].as_i64().unwrap();
            let bid = update["bidCents"].as_i64().unwrap();
            let ask = update["askCents"].as_i64().unwrap();

            assert!(price > 0);
            assert!(bid > 0);
            assert!(bid < ask);
            assert!(price == bid || price == ask);
            assert!(update["tradeQuantity"].as_u64().unwrap() > 0);
            assert!(update["bidQuantity"].as_u64().is_some());
            assert!(update["askQuantity"].as_u64().is_some());
        }
    }

    #[test]
    fn same_seed_produces_identical_updates() {
        let mut first = MarketGenerator::new(5.0, 42).unwrap();
        let mut second = MarketGenerator::new(5.0, 42).unwrap();

        assert_eq!(
            first.generate_batch(100.0).unwrap(),
            second.generate_batch(100.0).unwrap()
        );
    }

    #[test]
    fn different_seeds_produce_different_updates() {
        let mut first = MarketGenerator::new(5.0, 42).unwrap();
        let mut second = MarketGenerator::new(5.0, 43).unwrap();

        assert_ne!(
            first.generate_batch(100.0).unwrap(),
            second.generate_batch(100.0).unwrap()
        );
    }

    #[test]
    fn prices_are_preserved_independently_between_batch_calls() {
        let mut generator = MarketGenerator::new(5.0, 42).unwrap();
        let first_batch = updates(&mut generator, 5);
        let second_batch = updates(&mut generator, 5);

        for (first, second) in first_batch.iter().zip(second_batch.iter()) {
            assert_eq!(first["instrument"], second["instrument"]);
            let price_difference = (first["priceCents"].as_i64().unwrap()
                - second["priceCents"].as_i64().unwrap())
            .abs();
            assert!(price_difference <= MAX_PRICE_MOVEMENT_CENTS);
        }
    }

    #[test]
    fn symbols_are_stable_unique_and_prefer_requested_names() {
        let generator = MarketGenerator::new(7.0, 1).unwrap();

        assert_eq!(
            generator.get_instruments().unwrap(),
            r#"["ALFA","BETA","GAMMA","DELTA","EPSI","INST06","INST07"]"#
        );
    }

    #[test]
    fn rejects_invalid_constructor_and_batch_arguments() {
        assert_eq!(
            validate_instrument_count(0.0),
            Err("instrumentCount must be an integer from 1 to 50")
        );
        assert_eq!(
            validate_instrument_count(51.0),
            Err("instrumentCount must be an integer from 1 to 50")
        );
        assert!(validate_instrument_count(1.5).is_err());
        assert!(validate_instrument_count(f64::NAN).is_err());
        assert_eq!(
            validate_batch_count(0.0),
            Err("count must be an integer from 1 to 1000")
        );
        assert_eq!(
            validate_batch_count(1_001.0),
            Err("count must be an integer from 1 to 1000")
        );
        assert!(validate_batch_count(1.5).is_err());
        assert!(validate_batch_count(f64::INFINITY).is_err());
        assert_eq!(validate_instrument_count(1.0), Ok(()));
        assert_eq!(validate_instrument_count(50.0), Ok(()));
        assert_eq!(validate_batch_count(1.0), Ok(()));
        assert_eq!(validate_batch_count(1_000.0), Ok(()));
    }
}
