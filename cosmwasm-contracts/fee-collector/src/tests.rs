#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};
    use cosmwasm_std::{coins, from_json, Addr, Uint128};
    use crate::contract::{instantiate, execute, query};
    use crate::msg::{InstantiateMsg, ExecuteMsg, QueryMsg, ConfigResponse, StateResponse};

    #[test]
    fn proper_initialization() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("creator", &coins(1000, "earth"));

        let msg = InstantiateMsg {
            admin: "admin".to_string(),
            ibctfuel_token: "token_contract".to_string(),
            minter_contract: "minter_contract".to_string(),
            min_burn_amount: Uint128::from(1000u128),
        };

        let res = instantiate(deps.as_mut(), env.clone(), info, msg).unwrap();
        assert_eq!(0, res.messages.len());

        // Query config
        let res = query(deps.as_ref(), env.clone(), QueryMsg::Config {}).unwrap();
        let config: ConfigResponse = from_json(&res).unwrap();
        assert_eq!(config.admin, Addr::unchecked("admin"));
        assert_eq!(config.min_burn_amount, Uint128::from(1000u128));
        assert_eq!(config.paused, false);

        // Query state
        let res = query(deps.as_ref(), env, QueryMsg::State {}).unwrap();
        let state: StateResponse = from_json(&res).unwrap();
        assert_eq!(state.accumulated_fees, Uint128::zero());
        assert_eq!(state.total_burned, Uint128::zero());
        assert_eq!(state.total_burns_count, 0);
    }

    #[test]
    fn test_pause_unpause() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("creator", &[]);

        let msg = InstantiateMsg {
            admin: "admin".to_string(),
            ibctfuel_token: "token_contract".to_string(),
            minter_contract: "minter_contract".to_string(),
            min_burn_amount: Uint128::from(1000u128),
        };

        instantiate(deps.as_mut(), env.clone(), info, msg).unwrap();

        // Pause
        let admin_info = mock_info("admin", &[]);
        let pause_msg = ExecuteMsg::Pause {};
        execute(deps.as_mut(), env.clone(), admin_info.clone(), pause_msg).unwrap();

        let res = query(deps.as_ref(), env.clone(), QueryMsg::Config {}).unwrap();
        let config: ConfigResponse = from_json(&res).unwrap();
        assert_eq!(config.paused, true);

        // Unpause
        let unpause_msg = ExecuteMsg::Unpause {};
        execute(deps.as_mut(), env.clone(), admin_info, unpause_msg).unwrap();

        let res = query(deps.as_ref(), env, QueryMsg::Config {}).unwrap();
        let config: ConfigResponse = from_json(&res).unwrap();
        assert_eq!(config.paused, false);
    }

    #[test]
    fn test_unauthorized_pause() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("creator", &[]);

        let msg = InstantiateMsg {
            admin: "admin".to_string(),
            ibctfuel_token: "token_contract".to_string(),
            minter_contract: "minter_contract".to_string(),
            min_burn_amount: Uint128::from(1000u128),
        };

        instantiate(deps.as_mut(), env.clone(), info, msg).unwrap();

        // Try to pause as non-admin
        let non_admin_info = mock_info("not_admin", &[]);
        let pause_msg = ExecuteMsg::Pause {};
        let err = execute(deps.as_mut(), env, non_admin_info, pause_msg).unwrap_err();
        
        match err {
            crate::error::ContractError::Unauthorized {} => {}
            e => panic!("Unexpected error: {:?}", e),
        }
    }
}
